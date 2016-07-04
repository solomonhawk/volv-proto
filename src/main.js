import fs from 'fs'
import path from 'path'
import minimist from 'minimist'
import os from 'os'
import walk from 'recursive-readdir'
import async from 'async'

 // $ node volv-proto.js git_repo_url branch_name
const argv = minimist(process.argv.slice(2))

const DEFAULT_BRANCH = 'master'

const GIT_REPO_URL = argv._[0]
const BRANCH       = argv._[1] || DEFAULT_BRANCH

const USER_HOME_DIR = getUserHome()
const ROOT_VOLV_DIR = path.resolve(USER_HOME_DIR, '.volv')
const CACHE_DIR     = path.resolve(ROOT_VOLV_DIR, 'cache')
const REPORTS_DIR   = path.resolve(ROOT_VOLV_DIR, 'reports')
const TMP_DIR       = path.resolve(ROOT_VOLV_DIR, 'tmp')

main()

function main() {
  let cwd = process.cwd()

  // setup root `~/.volv` directory where volv caches data
  createRootVolvDir()

  // ensure `git` is available via shell
  checkGitInstallation()

  // create the `~/.volv/cache` dir if it doesn't exist. this is where
  // volv will cache partial analysis of git repos during computation
  createCacheDirectory()

  // create the `~/.volv/reports` dir if it doesn't exist. this is
  // where volv will output analysis summaries generated
  createReportsDirectory()

  // create the `~/.volv/tmp` dir if it doesn't exist. this is
  // where volv will clone the repo it's analyzing
  createTempDirectory()

  // clone the git repo into the temp directory
  cloneGitRepository()

  if (cd(TMP_DIR).code !== 0) {
    echo('Could not change to the temp directory: "' + TMP_DIR + '".')
    exit(1)
  }

  // get list of commit hashes in order
  const hashes = collectCommitHashList()

  // write reports with file sizes
  writeReportsForHashes(hashes)

  if (cd(cwd).code !== 0) {
    echo('Could not change directory back to: "' + cwd + '". Hmm... might be ok?')
  }

 // clear out the temp directory
  cleanUpTempDirectory()
}

function createRootVolvDir() {
  if (!fs.existsSync(ROOT_VOLV_DIR)) {
    if (mkdir(ROOT_VOLV_DIR).code !== 0) {
      echo('Could not create `.volv` directory in "' + USER_HOME_DIR + '".')
      exit(1)
    }
  }
}

function checkGitInstallation() {
  if (!which('git')) {
    echo('This program requires `git` to be installed.')
    exit(1)
  }
}

function createCacheDirectory() {

  if (!fs.existsSync(CACHE_DIR)) {
    if (mkdir(CACHE_DIR).code !== 0) {
      echo('Could not create `cache` directory in "' + ROOT_VOLV_DIR + '".')
      exit(1)
    }
  }
}

function createReportsDirectory() {
  if (!fs.existsSync(REPORTS_DIR)) {
    if (mkdir(REPORTS_DIR).code !== 0) {
      echo('Could not create `reports` directory. Check user permissions.')
      exit(1)
    }
  }
}

function createTempDirectory() {
  if (!fs.existsSync(TMP_DIR)) {
    if (mkdir(TMP_DIR).code !== 0) {
      echo('Could not create `tmp` directory. Check user permissions.')
      exit(1)
    }
  }
}

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
    echo('Found ' + hashes.length + ' commits to analyze!')
  } else {
    echo('No commit hashes found!')
    exit(1)
  }

  return hashes
}

function writeReportsForHashes(hashes) {
  const repoName = getRepoName()
  const PROJECT_REPORTS_DIR = path.resolve(REPORTS_DIR, repoName)

  if (mkdir(PROJECT_REPORTS_DIR).code !== 0) {
    echo('Could not create the reports dir: "' + + '" for this project.')
    exit(1)
  }

  const report = reportHash(repoName)

  async.map(hashes, report, (err, results) => {
    console.log(err, results)
  })
}

function reportHash(repoName) {
  return (hash, reportCallback) => {
    const output = []
    const errors = []

    // filename for the report for this commit
    const fileName = path.resolve(REPORTS_DIR, repoName, `${hash.slice(0, 8)}.json`)
    const wstream = fs.createWriteStream(fileName)

    // checkout the .git commit by hash
    checkout(hash)

    // recursively collect all files
    // TODO(shawk): allow configurable exclude parameter
    walk(TMP_DIR, ['.git'], (err, results) => {
      if (err) return errors.push(err)

      async.map(results, eachResult, (err, results) => {
        if (err) return reportCallback(err)

        wstream.write(JSON.stringify(results))
        wstream.end()

        reportCallback(null, results)
      })

      function eachResult(filePath, done) {
        fs.stat(filePath, (err, { size }) => {
          if (err) return done(err)
          done(null, { path: filePath, size })
        })
      }
    })
  }
}

function checkout(target) {
  cdToTempDir()

  let command = `git checkout ${target}`
  let result = exec(command, { silent: true })

  if (result.code !== 0) {
    echo('There was an error executing the command: "' + command + '".')
    exit(1)
  }

  return result
}

function revListAllReverse() {
  let command = `git rev-list --all --reverse --remove-empty --branches=${BRANCH}`
  let result = exec(command, { silent: true })

  if (result.code !== 0) {
    echo('There was an error executing the command: "' + command + '".')
    exit(1)
  }

  return result
}

function cdToTempDir() {
  if (cd(TMP_DIR).code !== 0) {
    echo('Could not change directory to: "' + TMP_DIR + '".')
    exit(1)
  }
}

function cleanUpTempDirectory() {
  let result = rm('-rf', TMP_DIR)

  if (result.code !== 0) {
    echo('There was a problem clearing the temp directory: "' + TMP_DIR + '". You may need to clear it manually. Sorry...')
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
