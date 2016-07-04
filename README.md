# Requirements:

* Node 5.9.0
* NPM 3.7.3
* git
* node
* unix (probably)
* read/write permissions in the User's Home directory

I recommend using `nvm` or `n` to manage Node versions. This project has a `.nvmrc` file in the root directory that tells `nvm` to load the correct version. You may need to run `nvm i`/`nvm install` after you change to this project's directory to pick up the version file.

# Installation:

    $ npm install

# Usage:

This hasn't been packaged into a shell app, so for now just use the `npm` alias which just fires up `node` with `src/index.js` loaded. It expects at least 1 argument to be passed.

    $ npm start <REPO_URL> [ <BRANCH_NAME> ]

Outputs a number of report files in $USER_HOME$/.volv/reports/<REPO_NAME>, one for each commit in the target branch, and each containing a list of all files w/ path and filesize - ordered by size.
