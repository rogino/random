/*
This tool deletes RAW (and XMP) files that haven't been edited. This is guessed through the presence of a XMP sidecar file produced by Lightroom or a similar program. 
This may fail on systems with case-insensitive file systems
*/


const fs = require("fs");
const path = require("path");

const inquirer = require("inquirer");
const trash = require("trash");
const {table} = require("table");

const rawExt = ".cr2";
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
let filterByExtension = (arr, ext) => arr.filter(obj => path.extname(obj.path) == ext);

//Changes the extension of a file. Extension must start with period
let changeExtension = (p, ext) => path.join(path.dirname(p), path.basename(p, path.extname(p)) + ext);

let fileMatchesExtensionWhitelist = (p, extArr) => {
  let ext = path.extname(p);
  return extArr.some(e => e == ext);
}

//Parameters under which a CR2 and XMP file is deleted. This converts the booleans into a integer which is easier to compare
let genCode = (xmp, jpg) => (xmp?2:0) + (jpg?1:0);

let saveToTextFile = filesToDelete => {
  console.log(`Deletion failed so saving list to ${backupTextFile}`);
  fs.writeFileSync(backupTextFile, filesToDelete.reduce((str, obj) => str + "\n" + obj.path, ""));
}

/** For an array of files, marks files for deletion
 * @return {object} object with number of files found for `raw`, `rawDelete`, `xmp`, `xmpDelete` and `jpeg`
*/
let findFilesToDelete = files => {
  let raw, jpg, jpeg, xmp;
  raw = []; jpg = []; jpeg = []; xmp = [];
  files.forEach(obj => {
    switch(path.extname(obj.path)) {
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
  raw.forEach(obj => {
    let jpgF = changeExtension(obj.path, jpgExt);
    let jpgFound = jpg.has(jpgF);

    let jpegF = changeExtension(obj.path, jpegExt);
    let jpegFound = jpeg.has(jpegF);

    let xmpF = changeExtension(obj.path, xmpExt);
    let xmpFound = xmp.has(xmpF);
    
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
    raw: raw.length,
    rawDelete: numRAWToDelete,
    xmp: xmp.length,
    xmpDelete: numXMPToDelete,
    jpeg: jpg.length + jpeg.length
  };
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
  unreadDirectories = [answers.baseDirectory]; //Start off with one directory to search
  deletionTypes = answers.deletionTypes;


  let extensionWhitelist = [rawExt, jpgExt, jpegExt, xmpExt];
  console.time(labelSearchTime);
  while (unreadDirectories.length) {
    let dir = unreadDirectories[0];

    process.stdout.write(`Number of discovered but unsearched directories remaining: ${unreadDirectories.length}${((unreadDirectories.length + 1).toString().length - (unreadDirectories.length).toString().length)?" ": ""}\r`); //Won't write a new line every time. Adds a space if the number of digits of the number increases changes

    let files = [];

    let scannedDir;
    try {
      scannedDir = fs.readdirSync(dir);
    } catch(err) {
      console.log(`\nCould not read directory ${dir} due to error:`);
      console.log(err);
      unreadDirectories.splice(0, 1); //Remove the scanned directory so it doens't infinite loop
      return;
    }

    scannedDir.forEach(p => {
      p = path.join(dir, p);
      let stat;
      try {
        stat = fs.statSync(p);
      } catch(err) {
        console.log(`\nCould not read file ${p} due to error:`);
        console.log(err);
        return; //Stop reading the file
      }

      if (stat.isDirectory() && !p.endsWith(".lrdata")) {
        //lrdata has a lot of directories, so avoid scanning those
        unreadDirectories.push(p);
      }
      else {
        if (fileMatchesExtensionWhitelist(p, extensionWhitelist)) {
          files.push({
            path: p,
            size: stat.size
          }); //Later, the size of the files will be totaled and since we already have that data, save it to the array
        }
      }
    });
    unreadDirectories.splice(0, 1); //Remove the scanned directory
    
    allFiles.push(...files); //Push to the global array
    let deletions = findFilesToDelete(files); //look at the files in that directory and search for those that need to be deleted.

    if (deletions.xmp || deletions.raw) {
      deletions.directory = dir;
      overviewOfDeletions.push(deletions); //Only add to overview if relevant files are found
    }
  }
  console.log(); //Add newline as the sdout doesn't
  console.timeEnd(labelSearchTime);
  

  console.log(`\n\nDeleting from the following directories:`);

  let nRAW, nRAWD, nXMP, nXMPD, nJPEG;
  nRAW = nRAWD = nXMP = nXMPD = nJPEG = 0;
  let arr = [];
  arr.push(["Directory", "No. RAW", "No. RAW delete", "No. XMP", "No. XMP delete", "No. JPEG"]);
  
  overviewOfDeletions.forEach(obj => {
    arr.push([path.relative(baseDirectory, obj.directory), obj.raw, obj.rawDelete, obj.xmp, obj.xmpDelete, obj.jpeg]);
    nRAW += obj.raw; nRAWD += obj.rawDelete; nXMP += obj.xmp; nXMPD += obj.xmpDelete; nJPEG += obj.jpeg;
  });

  arr.push(["Total", nRAW, nRAWD, nXMP, nXMPD, nJPEG]);

  console.log(table(arr)); //Print out the data as a nice table

  
  console.log(`Total of ${filterByExtension(allFiles, rawExt).length} RAW files found, ${filterByExtension(filesToDelete, rawExt).length} marked for deletion.`);
  console.log(`Total of ${filterByExtension(allFiles, xmpExt).length} XMP files found, ${filterByExtension(filesToDelete, xmpExt).length} marked for deletion.`);

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