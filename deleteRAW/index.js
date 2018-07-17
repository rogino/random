/*
This tool deletes RAW (and XMP) files that haven't been edited. This is guessed through the presence of a XMP sidecar file produced by Lightroom or a similar program. 
This may fail on systems with case-insensitive file systems
*/


const fs = require("fs");
const path = require("path");

const inquirer = require("inquirer");
const trash = require("trash");
const fse = require("fs-extra");
const { table } = require("table");

const rawExt = ".CR2";
const jpgExt = ".jpg";
const jpegExt = ".jpeg";
const xmpExt = ".xmp";

const backupTextFile = "./filesToDelete.txt"; //For if deletion fails, save to text file

let filesToDelete, allFiles, unreadDirectories, baseDirectory, deletionTypes;
filesToDelete = [];
allFiles = [];

let overviewOfDeletions = []; //Array of objects with directory name, number of XMP and number RAW files to be deleted


const labelSearchTime = "Time-taken-to-search-through-directory";


/**
 * Filters array by their extension.
 * @param {obj} arr Array of objects with properties `path` and `size` (bytes)
 * @param {string} ext Extension to filter for with a dot
 */
let filterByExtension = (arr, ext) => {
  ext = ext.toLowerCase();
  return arr.filter(obj => path.extname(obj.path).toLowerCase() == ext);
}

//Changes the extension of a file. Extension must start with period
let changeExtension = (p, ext) => path.join(path.dirname(p), path.basename(p, path.extname(p)) + ext);

let lowercaseExtension = p => path.join(path.dirname(p), path.basename(p, path.extname(p)) + path.extname(p).toLowerCase());

let fileMatchesExtensionWhitelist = (p, extArr) => {
  let ext = path.extname(p).toLowerCase();
  extArr = extArr.map(e => e.toLowerCase());
  return extArr.some(e => e == ext);
}

//Parameters under which a CR2 and XMP file is deleted. This converts the booleans into a integer which is easier to compare
let genCode = (xmp, jpg) => (xmp ? 2 : 0) + (jpg ? 1 : 0);

let saveToTextFile = filesToDelete => {
  console.log(`Deletion failed so saving list to ${backupTextFile}`);
  fs.writeFileSync(backupTextFile, filesToDelete.reduce((str, obj) => str + "\n" + obj.path, ""));
}

/** For an array of files, marks files for deletion
 * @return {object} object with number of files found for `raw`, `rawDelete`, `xmp`, `xmpDelete` and `jpeg`
*/
let determineIfFileShouldBeDeleted = flattenedTree => {
  let raw, jpg, jpeg, xmp;
  raw = []; jpg = []; jpeg = []; xmp = [];
  flattenedTree.files.forEach(obj => {
    switch (path.extname(obj.path)) {
      case rawExt:
        raw.push(obj);
        break;
      case jpgExt:
        jpg.push(obj);
        break;
      case jpegExt:
        jpeg.push(obj);
        break;
      case xmpExt:
        xmp.push(obj);
        break;
    }
  });

  let numRAWToDelete = 0;
  let numXMPToDelete = 0;
  
  let found = (p, arr) => arr.some(f => lowercaseExtension(f.path) == lowercaseExtension(p));

  raw.forEach(obj => {
    let jpgF = changeExtension(obj.path, jpgExt);
    let jpgFound = found(jpgF, jpg);

    let jpegF = changeExtension(obj.path, jpegExt);
    let jpegFound = found(jpegF, jpeg);


    let xmpF = changeExtension(obj.path, xmpExt);
    let xmpFound = found(xmpF, xmp);

    let code = genCode(xmpFound, jpgFound || jpegFound);

    if (deletionTypes.indexOf(code) != -1) {
      //One of the options the user selected matches the code for the current file, so delete
      filesToDelete.push(obj);
      numRAWToDelete++;
      if (xmpFound) {
        filesToDelete.push(xmpF);
        numXMPToDelete++;
      }
    }

  });

  return {
    directory: flattenedTree.directory,
    raw: raw.length,
    rawDelete: numRAWToDelete,
    xmp: xmp.length,
    xmpDelete: numXMPToDelete,
    jpeg: jpg.length + jpeg.length
  };
}

let scanForRelevantFiles = dir => {
  let strLen = 0;
  let recursiveScan = (dir, depth = 0) => {
    let str = `Searching ${dir}`;
    let diff = str.length - strLen; //\r means overwriting so add spaces if the string gets shorter
    if (strLen != 0 && diff > 0) {
      while(--diff >= 0) {
        str += " "; //If string gets shorter, add space to overwrite
      }
    }
    strLen = str.length;
    process.stdout.write(str + "\r");

    let ignoreDir = [/\.lrdata$/];
    let extensionWhitelist = [rawExt, jpgExt, jpegExt, xmpExt];
    let promises = [];
    
    return fse.readdir(dir).then(contents => {
      contents.forEach(p => {
        p = path.join(dir, p);
        promises.push(fse.stat(p).then(stats => {
          if (stats.isDirectory() && !ignoreDir.some(reg => reg.test(p))) return recursiveScan(p, depth + 1); //Recursively run for the subdirectory
          // else {
          else if (fileMatchesExtensionWhitelist(p, extensionWhitelist)) {
            return Promise.resolve({
              path: p,
              size: stats.size
            });
          } else return Promise.resolve(null);
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

  return recursiveScan(path.normalize(dir)).then(arr => {
    console.log("\n\n"); //Get past the \r
    //Array of either objects (path, size), subarray (results from recursive calls), null (failed), or string (directory name);
    //Converts the nested arrays into an array of arrays
    let flatten = (arr, depth = 0) => {
      let flattened = [];
      let stuffFromOutermostDirectory = []; //Objects (scanned files) or string (name of directory)
      arr.forEach(thing => {
        if (Array.isArray(thing)) flattened.push(...flatten(thing, depth + 1)); //Recursively flatten everything
        else if (thing !== null) stuffFromOutermostDirectory.push(thing);
      });
      if (stuffFromOutermostDirectory.length) flattened.push(stuffFromOutermostDirectory); //Only push if there are files in the array

      return flattened;
    }

    let final = [];
    

    flatten(arr).forEach(subArr => { //The flattening is only an intermediate stage
      final.push({
        directory: path.dirname(subArr[0].path),
        files: subArr
      });
    });
    return Promise.resolve(final);
  }).catch(err => {
    throw new Error(`Something bad happened after scanning the directory ${dir}:\n${err}`);
  });
}


console.log("This tool deletes RAW files that don't have associated XMP sidecar files of the same name in the same directory");
inquirer.prompt([
  {
    type: "input",
    name: "baseDirectory",
    message: "Enter directory to search",
    validate: dir => fs.existsSync(dir)?true: "Could not find the given directory"
  },
  {
    type: "checkbox",
    name: "deletionTypes",
    message: "Delete RAW and XMP files on the following cases",
    choices: [{
      name: "RAW only",
      value: genCode(0,0),
      checked: true
    }, {
      name: "RAW and XMP but no JPEG",
      value: genCode(1,0),
      checked: false
    }, {
      name: "RAW, XMP and JPEG files all exist",
      value: genCode(1,1),
      checked: false
    }, {
      name: "RAW and JPG but no XMP",
      value: genCode(0,1),
      checked: false
    }]
  }
]).then(answers => {
  baseDirectory = answers.baseDirectory;
  deletionTypes = answers.deletionTypes;

  console.time(labelSearchTime);
  return scanForRelevantFiles(baseDirectory);
}).then(relevantFiles => {
  console.timeEnd(labelSearchTime);
  
  relevantFiles.forEach(directory => {
    overviewOfDeletions.push(determineIfFileShouldBeDeleted(directory)); //look at the files in that directory and search for those that need to be deleted.
  });

  

  console.log(`\nDeleting from the following directories:`);

  let nRAW, nRAWD, nXMP, nXMPD, nJPEG;
  nRAW = nRAWD = nXMP = nXMPD = nJPEG = 0;
  let arr = [];
  arr.push(["Directory", "No. RAW", "No. RAW delete", "No. XMP", "No. XMP delete", "No. JPEG"]);

  overviewOfDeletions.forEach(obj => {
    let dirStr = path.relative(baseDirectory, obj.directory);
    if (dirStr == "") dirStr = "." + path.sep; //If empty, means it is the base directory
    arr.push([path.relative(baseDirectory, obj.directory), obj.raw, obj.rawDelete, obj.xmp, obj.xmpDelete, obj.jpeg]);
    nRAW += obj.raw; nRAWD += obj.rawDelete; nXMP += obj.xmp; nXMPD += obj.xmpDelete; nJPEG += obj.jpeg;
  });

  arr.push(["Total", nRAW, nRAWD, nXMP, nXMPD, nJPEG]);

  console.log(table(arr)); //Print out the data as a nice table


  console.log(`Total of ${nRAW} RAW files found, ${nRAWD} marked for deletion.`);
  console.log(`Total of ${nXMP} XMP files found, ${nXMPD} marked for deletion.`);

  let spaceSaved = filesToDelete.reduce((sum, obj) => sum += obj.size, 0);
  console.log(`Total size of all files marked for deletion: ${spaceSaved} bytes / ${Math.round(spaceSaved / 1024)}KB / ${Math.round(spaceSaved / (Math.pow(1024, 2)))}MB / ${Math.round(spaceSaved / (Math.pow(1024, 3)))}GB`);

}).then(() => inquirer.prompt([
  {
    type: "list",
    name: "toTrash",
    message: "Send to trash or delete?",
    choices: [{
      name: "Trash",
      value: true
    },
    {
      name: "Delete permanently",
      value: false
    }]
  },{
  type: "confirm",
  message: `Really delete ${filesToDelete.length} files?`,
  name: "reallyDelete"
}])).then(answers => {
  if (answers.reallyDelete) {
    if (answers.toTrash) {
      trash(filesToDelete.map(obj => obj.path)).then(() => {
        console.log(`${filesToDelete.length} files sent to trash`);
      }).catch(err => {
        console.log(`Error deleting files`);
        console.log(err);

        saveToTextFile(filesToDelete);
      })
    }
    else {
      let failed = [];
      filesToDelete.forEach(obj => {
          try {
            fs.unlinkSync(obj.path);
          }
          catch(err) {
            console.log(`Failed to delete ${obj.path}`);
            failed.push(obj);
          }
      });
      console.log(`${filesToDelete.length - failed.length} files deleted`);
      console.log(`Failed files saved to text file`);
      saveToTextFile(failed);
    }
  }

  else console.log("Deletion cancelled");
});
