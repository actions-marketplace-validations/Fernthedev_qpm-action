import { getActionParameters, getReleaseDownloadLink, githubExecAsync } from './utils.js'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { QPMPackage, QPMSharedPackage, readQPM, writeQPM } from './qpm_file.js'
import { QPM_COMMAND_PUBLISH } from './constants.js'
import { GitHub } from '@actions/github/lib/utils.js'
import path from 'path'

async function doPublish(
  octokit: InstanceType<typeof GitHub>,
  release: boolean,
  debug: boolean,
  qmod: string | undefined,
  version: string | undefined,
  tag: string | undefined,
  package_path: string | undefined
): Promise<void> {
  core.info('Publishing')
  const qpmSharedPath = path.join(package_path ?? '.', 'qpm.shared.json')
  const qpmPath = path.join(package_path ?? '.', 'qpm.json')
  //path.join(
  //  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  // process.env.GITHUB_WORKSPACE!,
  // 'qpm.shared.json'
  // )
  const qpmSharedFile = await readQPM<QPMSharedPackage>(qpmSharedPath)
  const qpmFile = await readQPM<QPMPackage>(qpmPath)

  if (version) {
    core.info(`Overwriting version with provided ${version}`)
    qpmSharedFile.config.info.version = version
  }
  version ??= qpmSharedFile.config.info.version
  core.info(`Using version ${version} for publishing`)

  const branch = `version/v${version.replace(/\./g, '_')}`
  qpmSharedFile.config.info.additionalData.branchName = branch
  // assign to current github repo
  qpmSharedFile.config.info.url = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}`

  const additionalData = qpmSharedFile.config.info.additionalData

  const download = getReleaseDownloadLink(github.context.repo.owner, github.context.repo.repo, tag ?? version)

  const fileId = qpmSharedFile.config.info.id
  const fixedFileVersion = version.replace(/\./g, '_')
  if (release) {
    const versionedName = `lib${fileId}_${fixedFileVersion}.so`
    const name = additionalData.overrideSoName ?? versionedName

    qpmSharedFile.config.info.additionalData.soLink = `${download}/${name}`
  }

  if (debug) {
    const nameOverride = additionalData.overrideSoName && `debug_${additionalData.overrideSoName}`

    const debugVersionedName = `debug_lib${fileId}_${fixedFileVersion}.so`

    const name = additionalData.overrideDebugSoName ?? nameOverride ?? debugVersionedName

    qpmSharedFile.config.info.additionalData.debugSoLink = `${download}/${name}`
  }

  if (qmod) {
    qpmSharedFile.config.info.additionalData.modLink = `${download}/${qmod}`
  }

  await writeQPM(qpmSharedPath, qpmSharedFile)

  const git = octokit.rest.git

  await core.group<void>('Publish', async () => {
    // create branch
    // reference https://github.com/peterjgrainger/action-create-branch/blob/c2800a3a9edbba2218da6861fa46496cf8f3195a/src/create-branch.ts#L3
    const branchHead = `heads/${branch}`
    const branchRef = `refs/${branchHead}`

    core.info('Getting data')
    // get current repo data
    const lastCommitSha = github.context.sha
    const lastCommit = await git.getCommit({
      ...github.context.repo,
      commit_sha: lastCommitSha
    })

    try {
      core.info('creating new branch')
      await git.createRef({
        ...github.context.repo,
        ref: branchRef,
        sha: lastCommitSha,
        key: branchRef
      })
    } catch (e) {
      core.warning(`Creating new branch ${branch} failed due to ${e}`)
    }

    core.info('Creating commit')
    // create commit
    const newTree = await git.createTree({
      ...github.context.repo,
      tree: [
        {
          content: JSON.stringify(qpmSharedFile),
          path: qpmSharedPath,
          mode: '100644'
        },
        {
          content: JSON.stringify(qpmFile),
          path: qpmPath,
          mode: '100644'
        }
      ],
      base_tree: lastCommit.data.tree.sha
    })
    const commit = await git.createCommit({
      ...github.context.repo,
      parents: [lastCommitSha],
      message: 'Update version and post restore',
      tree: newTree.data.sha
    })

    // update branch
    core.info(`Updating branch ${branchRef} ${commit.data.sha}`)
    await git.updateRef({
      ...github.context.repo,
      ref: branchHead,
      sha: commit.data.sha,
      force: true
    })
  })
  // do github stuff
}

export async function publishRun(params: ReturnType<typeof getActionParameters>): Promise<void> {
  const { token, qpmDebugBin, qpmQmod, qpmReleaseBin, version, publishToken, tag, packagePath } = params

  const octokit = github.getOctokit(token)

  await doPublish(octokit, qpmReleaseBin, qpmDebugBin, qpmQmod, version, tag, packagePath)
  await githubExecAsync('qpm', [QPM_COMMAND_PUBLISH, publishToken ?? ''], {
    cwd: packagePath
  })
}
