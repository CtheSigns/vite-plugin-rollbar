// Custom rollup plugin for uploading rollbar deploys
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import VError from 'verror'
import { ROLLBAR_ENDPOINT } from './constants'

async function uploadSourcemap(form, { filename, rollbarEndpoint, silent }) {
  const errMessage = `Failed to upload ${filename} to Rollbar`

  let res
  try {
    res = await fetch(rollbarEndpoint, {
      method: 'POST',
      body: form
    })
  } catch (err) {
    // Network or operational errors
    throw new VError(err, errMessage)
  }

  // 4xx or 5xx response
  if (!res.ok) {
    // Attempt to parse error details from response
    let details
    try {
      const body = await res.json()
      details = body?.message ?? `${res.status} - ${res.statusText}`
    } catch (parseErr) {
      details = `${res.status} - ${res.statusText}`
    }

    throw new Error(`${errMessage}: ${details}`)
  }

  // Success
  if (!silent) {
    console.info(`Uploaded ${filename} to Rollbar`)
  }
}

export default function rollbarSourcemaps({
  accessToken,
  version,
  baseUrl,
  silent = false,
  rollbarEndpoint = ROLLBAR_ENDPOINT,
  ignoreUploadErrors = true,
  base = '/',
  outputDir = 'dist'
}) {
  return {
    localProps: {
      accessToken,
      version,
      baseUrl,
      silent,
      rollbarEndpoint
    },
    name: 'vite-plugin-rollbar',
    async writeBundle(options, bundle) {
      const files = Object.keys(bundle).filter((file) => path.extname(file) == '.js').map((file) => `${file}.map`);
      const sourcemaps = files
        .map((file) => {
          const sourcePath = file.replace(/\.map$/, '')
          const sourcemapLocation = resolve(outputDir, file)

          try {
            return {
              content: readFileSync(sourcemapLocation, 'utf8'),
              sourcemap_url: sourcemapLocation,
              original_file: `${base}${sourcePath}`
            }
          } catch (error) {
            console.error(`Error reading sourcemap file ${sourcemapLocation}: ${error}`, true)
            return null
          }
        })
        .filter((file) => !!file);

      if (!sourcemaps.length) return

      try {
        await Promise.all(
          sourcemaps.map((asset) => {
            const minifiedUrl = `${baseUrl}${asset.original_file}`;
            
            const form = new FormData()
            form.set('access_token', accessToken)
            form.set('version', version)
            form.set('minified_url', `${baseUrl}${asset.original_file}`)
            form.set('source_map', new Blob([asset.content]), asset.original_file)

            return uploadSourcemap(form, {
              filename: asset.original_file,
              rollbarEndpoint,
              silent
            })
          })
        )
      } catch (error) {
        if (ignoreUploadErrors) {
          console.error('Uploading sourcemaps to Rollbar failed: ', error)
          return
        }
        throw error
      }
    }
  }
}
