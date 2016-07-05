import fs from 'fs'
import path from 'path'
import minimist from 'minimist'
import os from 'os'
import walk from 'recursive-readdir'
import async from 'async'
import logger from 'winston'

 // $ node volv-proto.js git_repo_url branch_name
const argv = minimist(process.argv.slice(2))

const DEFAULT_BRANCH = 'master'

const GIT_REPO_URL = argv._[0]
const BRANCH       = argv._[1] || DEFAULT_BRANCH

const REPO_NAME        = getRepoName()
const USER_HOME_DIR    = getUserHome()
const ROOT_VOLV_DIR    = path.resolve(USER_HOME_DIR, '.volv')
const CACHE_DIR        = path.resolve(ROOT_VOLV_DIR, 'cache')
const REPORTS_DIR      = path.resolve(ROOT_VOLV_DIR, 'reports')
const TMP_DIR          = path.resolve(ROOT_VOLV_DIR, 'tmp')
const REPO_REPORTS_DIR = path.resolve(REPORTS_DIR, REPO_NAME)

main()

function main() {
  let cwd = process.cwd()

  checkGitInstallation()
  createRootVolvDir()
  createCacheDirectory()
  createReportsDirectory()
  createRepoReportDirectory()
  createTempDirectory()
  cleanUpTempDirectory()
  cloneGitRepository()

  if (cd(TMP_DIR).code !== 0) {
    echo('Could not change to the temp directory: "' + TMP_DIR + '".')
    exit(1)
  }

  const hashes = collectCommitHashList()

  writeReportsForHashes(hashes, (err, results) => {
    if (err) {
      logger.error(err)
    } else {
      aggregateResults(results)
    }

    cleanUpTempDirectory()
  })


  if (cd(cwd).code !== 0) {
    echo('Could not change directory back to: "' + cwd + '". Hmm... might be ok?')
  }
}

// ensure `git` is available via shell
function checkGitInstallation() {
  if (!which('git')) {
    logger.error('This program requires `git` to be installed.')
    exit(1)
  }

  logger.info('✓ `git` is installed.')
}

// setup root `~/.volv` directory where volv caches data
function createRootVolvDir() {
  if (!fs.existsSync(ROOT_VOLV_DIR)) {
    if (mkdir(ROOT_VOLV_DIR).code !== 0) {
      echo('Could not create `.volv` directory in "' + USER_HOME_DIR + '".')
      exit(1)
    }

    logger.info('Created root `.volv` directory: "' + ROOT_VOLV_DIR + '".')
  }
}

// create the `~/.volv/cache` dir if it doesn't exist. this is where
// volv will cache partial analysis of git repos during computation
function createCacheDirectory() {
  if (!fs.existsSync(CACHE_DIR)) {
    if (mkdir(CACHE_DIR).code !== 0) {
      logger.error('Could not create `cache` directory in "' + ROOT_VOLV_DIR + '".')
      exit(1)
    }

    logger.info('Created cache directory: "' + CACHE_DIR + '".')
  }
}

// create the `~/.volv/reports` dir if it doesn't exist. this is
// where volv will output analysis summaries generated
function createReportsDirectory() {
  if (!fs.existsSync(REPORTS_DIR)) {
    if (mkdir(REPORTS_DIR).code !== 0) {
      logger.error('Could not create `reports` directory. Check user permissions.')
      exit(1)
    }

    logger.info('Created `reports` directory: "' + REPORTS_DIR + '".')
  }
}

// create the `~/.volv/reports/<REPO_NAME>` dir if it doesn't exist. this is
// where volv will store analysis results from this project
function createRepoReportDirectory() {
  if (!fs.existsSync(REPO_REPORTS_DIR)) {
    if (mkdir(REPO_REPORTS_DIR).code !== 0) {
      logger.error('Could not create the reports dir: "' + + '" for this project.')
      exit(1)
    }

    logger.info('Created `reports` directory for repo: "' + REPO_REPORTS_DIR + '".')
  }
}

// create the `~/.volv/tmp` dir if it doesn't exist. this is
// where volv will clone the repo it's analyzing
function createTempDirectory() {
  if (!fs.existsSync(TMP_DIR)) {
    if (mkdir(TMP_DIR).code !== 0) {
      logger.error('Could not create `tmp` directory. Check user permissions.')
      exit(1)
    }

    logger.info('Created temp directory: "' + TMP_DIR + '".')
  }
}

// clone the git repo into the temp directory
function cloneGitRepository() {
  let command = `git clone ${GIT_REPO_URL} ${TMP_DIR}`
  let result = exec(command)

  if(result.code !== 0) {
    echo('Could not execute: "' + command + '". There was a problem cloning the git repository. Check that your git username and password are correct and that your user has permission to clone the repo via the protocol in the provided URL.')
    exit(1)
  }
}

function collectCommitHashList() {
  checkout(BRANCH)

  let result = revListAllReverse()

  // split the stdout output on newlines and filter out empty strings if there are any
  let hashes = result.toString().split(os.EOL).filter(hash => hash.length)

  if (hashes.length) {
    logger.info('Found ' + hashes.length + ' commits to analyze.')
  } else {
    logger.error('No commit hashes found.')
    exit(1)
  }

  return hashes
}

function writeReportsForHashes(hashes, done) {
  async.mapSeries(hashes, reportHash, done)
}

function reportHash(hash, reportCallback) {
  const errors = []

  // checkout the .git commit by hash
  checkout(hash)

  // recursively collect all files
  // TODO(shawk): allow configurable exclude parameter
  walk(TMP_DIR, ['.git'], (err, filePaths) => {
    if (err) return errors.push(err)

    logger.info(`Examining ${ filePaths.length } files.`)

    async.map(filePaths, eachResult, (err, results) => {
      if (err) return reportCallback(err)

      const fileName = path.resolve(REPO_REPORTS_DIR, `${hash}.json`)
      const wstream = fs.createWriteStream(fileName)

      wstream.write(JSON.stringify(results))
      wstream.end()

      reportCallback(null, { hash, files: results })
    })

    function eachResult(filePath, done) {
      fs.stat(filePath, (err, { size }) => {
        if (err) return done(err)
        done(null, { fullPath: filePath, relPath: filePath.replace(TMP_DIR, ''), size })
      })
    }
  })
}

function aggregateResults(reports) {
  const output = {}

  reports.forEach(({ hash, files }) => {
    files.forEach(({ size, relPath, fullPath }) => {
      var out = (output[relPath] = output[relPath] || { relPath, fullPath })
      out.sizes = out.sizes || {}
      out.sizes[hash] = size
    })
  })

  console.log(output)
}

function checkout(target) {
  logger.info('Checking out: "' + target + '".')

  cdIntoTempDir()

  let command = `git checkout ${target}`
  let result = exec(command, { silent: true })

  if (result.code !== 0) {
    logger.error('There was an error executing the command: "' + command + '".')
    exit(1)
  }

  return result
}

function revListAllReverse() {
  let command = `git rev-list --all --reverse --remove-empty --branches=${BRANCH}`
  let result = exec(command, { silent: true })

  if (result.code !== 0) {
    logger.error('There was an error executing the command: "' + command + '".')
    exit(1)
  }

  return result
}

function cdIntoTempDir() {
  if (cd(TMP_DIR).code !== 0) {
    logger.error('Could not change directory to: "' + TMP_DIR + '".')
    exit(1)
  }
}

function cleanUpTempDirectory() {
  logger.info('Cleaning temp directory.')

  let result = rm('-rf', TMP_DIR)

  if (result.code !== 0) {
    logger.error('There was a problem clearing the temp directory: "' + TMP_DIR + '". You may need to clear it manually. Sorry...')
    exit(1)
  }
}

function getRepoName() {
  let arr = GIT_REPO_URL.split('/')
  return arr[arr.length - 1]
}

function getUserHome() {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']
}
