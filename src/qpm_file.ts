import * as fs from 'fs/promises'
import * as fsOld from 'fs'

export interface QPMSharedPackage {
  config: QPMPackage
}

export interface QPMPackage {
  info: {
    name: string
    id: string
    version: string
    url: string
    additionalData: {
      branchName?: string
      headersOnly?: boolean
      overrideSoName?: string
      overrideDebugSoName?: string
      soLink?: string
      debugSoLink?: string
      modLink?: string
    }
  }
  workspace?: {
    ndk?: string
  }
}

export async function readQPM<T extends QPMPackage | QPMSharedPackage>(file: fsOld.PathLike): Promise<T> {
  return JSON.parse((await fs.readFile(file, undefined)).toString())
}

export async function writeQPM(file: fsOld.PathLike, qpm: QPMPackage | QPMSharedPackage): Promise<void> {
  const qpmStr = JSON.stringify(qpm)
  await fs.writeFile(file, qpmStr)
}
