import { log } from '../helpers'

export const createDescriptiveErrorClass = (error_name: string) => {
  return class DescriptiveError extends Error {
    constructor(message: string) {
      super(`${error_name}\n${message}`)

      log(`❤️${error_name}❤️\n\n${message}`)
    }
  }
}
