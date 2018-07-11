let fileMatchesExtensionWhitelist = (p, extArr) => {
  let ext = path.extname(p);
  return extArr.some(e => e == ext);
}

/**
 * @param {string} dir Directory to recursively scan
 */
let recursiveScanAsync = (dir, depth = 0) => {
  let promises = [];

  return fse.readdir(dir).then(contents => {
    contents.forEach(p => {
      p = path.join(dir, p);
      promises.push(fse.stat(p).then(stats => {
        if (stats.isDirectory() && !directoryBlacklist.some(reg => reg.test(p))) return scan(p, depth + 1); //Recursively run for the subdirectory
        else return Promise.resolve(p);
      }).catch(err => {
        console.log(`\nCould not read file ${p} due to error:`);
        console.log(err);
        return Promise.resolve(null);
      }));
    });

    return Promise.all(promises).then(promises => {
      return promises.filter(a => a !== null).filter(a => {
        if (Array.isArray(a)) {
          return a.length;
        }
        return true;
      }); //Remove null (failed to read file stats or directory, or not the right file type) and empty arrays
    });

  }).catch(err => {
    console.log(`Could not read directory ${dir}:`);
    console.log(err);
    return Promise.resolve(null);
  });

}