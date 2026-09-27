const fs = require('fs');

// We need to restore the tests to their working state.
// Let's reset all the 5 test files to HEAD^ (the state of the commit we submitted, before the cleanup).
// Oh wait, we haven't committed the cleanup yet, the files are modified in our working tree.
