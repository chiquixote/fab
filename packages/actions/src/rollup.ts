import { OutputOptions, rollup, RollupOptions } from 'rollup'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import typescript from '@rollup/plugin-typescript'

// @ts-ignore
import alias from '@rollup/plugin-alias'
// @ts-ignore
import hypothetical from 'rollup-plugin-hypothetical'

import { _log } from '@fab/cli'
const log = _log(`rollup`)

export async function rollupCompile(
  input: string,
  generate_opts: OutputOptions,
  hypothetical_files = {},
  options: RollupOptions = {}
) {
  const empty = require.resolve(__dirname + '/empty')
  const entries = {
    path: require.resolve('path-browserify'),
    'node-fetch': empty,
  }

  try {
    const bundle = await rollup({
      input,
      plugins: [
        hypothetical({
          files: hypothetical_files,
          allowFallthrough: true,
        }),
        alias({ entries }),
        resolve({
          preferBuiltins: true,
        }),
        commonjs(),
        typescript({
          tsconfig: false,
          include: ['/**/*.ts', '/**/*.tsx'],
        }),
        json(),
      ],
      ...options,
    })
    return bundle.generate(generate_opts)
  } catch (e) {
    if (e.code) {
      log.error(`Error: ${e.code}`)
      if (e.loc) {
        log.error(`Failed at:`)
        console.log(e.loc)
      }
      if (e.frame) {
        log.error(`At frame:`)
        console.log(e.frame)
      }
      log.error(`Stack trace follows:`)
    }
    throw e
  }
}
