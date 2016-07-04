/**
 * Main entry point.
 **/

// allow usage of customizable ES6 features
require('babel-register')

// modify environment to provide unix-style shell command functions
require('shelljs/global')

// run the main program
require('./main')
