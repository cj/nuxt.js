'use strict'

const debug = require('debug')('nuxt:generate')
import fs from 'fs-extra'
import co from 'co'
import pify from 'pify'
import pathToRegexp from 'path-to-regexp'
import _ from 'lodash'
import { resolve, join, dirname, sep } from 'path'
import { promisifyRouteParams } from './utils'
import { minify } from 'html-minifier'
const copy = pify(fs.copy)
const remove = pify(fs.remove)
const writeFile = pify(fs.writeFile)
const mkdirp = pify(fs.mkdirp)

const defaults = {
  dir: 'dist',
  routeParams: {}
}

export default function () {
  const s = Date.now()
  /*
  ** Set variables
  */
  this.options.generate = _.defaultsDeep(this.options.generate, defaults)
  var self = this
  var srcStaticPath = resolve(this.srcDir, 'static')
  var srcBuiltPath = resolve(this.dir, '.nuxt', 'dist')
  var distPath = resolve(this.dir, this.options.generate.dir)
  var distNuxtPath = join(distPath, (this.options.build.publicPath.indexOf('http') === 0 ? '_nuxt' : this.options.build.publicPath))
  return co(function * () {
    /*
    ** Launch build process
    */
    yield self.build()
    /*
    ** Clean destination folder
    */
    try {
      yield remove(distPath)
      debug('Destination folder cleaned')
    } catch (e) {}
    /*
    ** Copy static and built files
    */
    if (fs.existsSync(srcStaticPath)) {
      yield copy(srcStaticPath, distPath)
    }
    yield copy(srcBuiltPath, distNuxtPath)
    debug('Static & build files copied')
  })
  .then(() => {
    // Resolve config.generate.routesParams promises before generating the routes
    return resolveRouteParams(this.options.generate.routeParams)
  })
  .then(() => {
    /*
    ** Generate html files from routes
    */
    let routes = []
    const routeKeys = Object.keys(this.options.generate.routeParams || {})

    this.routes.forEach((route) => {
      if (route.includes(':') || route.includes('*') || routeKeys.includes(route)) {
        const routeParams = this.options.generate.routeParams[route]

        if (routeParams === undefined) {
          console.error(`Could not generate the dynamic route ${route}, please add the mapping params in nuxt.config.js (generate.routeParams).`) // eslint-disable-line no-console
          return process.exit(1)
        } else if (routeParams) {
          route = route + '?'
          const toPath = pathToRegexp.compile(route)
          routes = routes.concat(routeParams.map((params) => {
            return toPath(params)
          }))
        }
      } else {
        routes.push(route)
      }
    })
    return co(function * () {
      while (routes.length) {
        yield routes.splice(0, 500).map((route) => {
          return co(function * () {
            var { html } = yield self.renderRoute(route, { _generate: true })
            html = minify(html, {
              collapseBooleanAttributes: true,
              collapseWhitespace: true,
              decodeEntities: true,
              minifyCSS: true,
              minifyJS: true,
              processConditionalComments: true,
              removeAttributeQuotes: false,
              removeComments: false,
              removeEmptyAttributes: true,
              removeOptionalTags: true,
              removeRedundantAttributes: true,
              removeScriptTypeAttributes: true,
              removeStyleLinkTypeAttributes: true,
              removeTagWhitespace: true,
              sortAttributes: true,
              sortClassName: true,
              trimCustomFragments: true,
              useShortDoctype: true
            })
            var path = join(route, sep, 'index.html') // /about -> /about/index.html
            debug('Generate file: ' + path)
            path = join(distPath, path)
            // Make sure the sub folders are created
            yield mkdirp(dirname(path))
            yield writeFile(path, html, 'utf8')
          })
        })
      }
    })
  })
  .then((pages) => {
    // Add .nojekyll file to let Github Pages add the _nuxt/ folder
    // https://help.github.com/articles/files-that-start-with-an-underscore-are-missing/
    const nojekyllPath = resolve(distPath, '.nojekyll')
    return writeFile(nojekyllPath, '')
  })
  .then(() => {
    const duration = Math.round((Date.now() - s) / 100) / 10
    debug(`HTML Files generated in ${duration}s`)
    return this
  })
}

function resolveRouteParams (routeParams) {
  let promises = []
  Object.keys(routeParams).forEach(function (routePath) {
    let promise = promisifyRouteParams(routeParams[routePath])
    promise.then((routeParamsData) => {
      routeParams[routePath] = routeParamsData
    })
    .catch((e) => {
      console.error(`Could not resolve routeParams[${routePath}]`) // eslint-disable-line no-console
      console.error(e) // eslint-disable-line no-console
      process.exit(1)
    })
    promises.push(promise)
  })
  return Promise.all(promises)
}
