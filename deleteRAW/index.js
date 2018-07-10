/*
This tool deletes RAW (and XMP) files that haven't been edited. This is guessed through the presence of a XMP sidecar file produced by Lightroom or a similar program. 
This may fail on systems with case-sensitive file systems
*/



let fs = require("fs");
let path = require("path");
let inquirer = require("inquirer");
let trash = require("trash");

const rawExt = ".cr2";
const jpgExt = ".jpg";
const jpegExt = ".jpeg";
const xmpExt = ".xmp";

let filesToDelete, allFiles, unreadDirectories, baseDirectory, deletionTypes;
filesToDelete = [];
allFiles = [];

let overviewOfDeletions = []; //Array of objects with directory name, number of XMP and number RAW files to be deleted


const labelSearchTime = "Time-taken-to-search-through-directory";
const labelSumFileSizes = "Time-taken-to-find-total-size-of-files-to-delete";

//Ensures an extension has a dot before it
let ensureExtensionHasDot = ext => (ext[0] == "." ? "" : ".") + ext;

//Filters array of filenames by their extension
let filterByExtension = (arr, ext) => {
  ext = ensureExtensionHasDot(ext);
  return arr.filter(name => path.extname(name) == ext);
}

//Ensure all filename extensions are lowercase. Will cause trouble on case-sensitive filesystems
let lowercaseExtension = p => path.join(path.dirname(p), path.basename(p, path.extname(p)) + path.extname(p).toLowerCase());

//Changes the extension of a file
let changeExtension = (p, ext) => path.join(path.dirname(p), path.basename(p, path.extname(p)) + ensureExtensionHasDot(ext));

let fileMatchesExtensionWhitelist = (p, extArr) => {
  let ext = path.extname(p).toLowerCase();
  return extArr.some(e => e == ext);
}

//Finds the total file size of files marked for deletion
let findTotalFileSize = () => filesToDelete.reduce((prev, curr) => prev + fs.statSync(curr).size, 0);

//Parameters under which a CR2 and XMP file is deleted. This converts the booleans into a integer which is easier to compare
let genCode = (xmp, jpg) => (xmp?2:0) + (jpg?1:0);

//For an array of files, files are marked for deletion
let findFilesToDelete = files => {
  let raw = filterByExtension(files, rawExt);
  let jpg = new Set(filterByExtension(files, jpgExt));
  let jpeg = new Set(filterByExtension(files, jpegExt));
  let xmp = new Set(filterByExtension(files, xmpExt));

  let numRAWToDelete = 0;
  let numXMPToDelete = 0;
  raw.forEach(p => {
    let jpgF = changeExtension(p, jpgExt);
    let jpgFound = jpg.has(jpgF);

    let jpegF = changeExtension(p, jpegExt);
    let jpegFound = jpeg.has(jpegF);

    let xmpF = changeExtension(p, xmpExt);
    let xmpFound = xmp.has(xmpF);
    
    let code = genCode(xmpFound, jpgFound || jpegFound);

    if (deletionTypes.indexOf(code) != -1) {
      //One of the options the user selected matches the code for the current file, so delete
      filesToDelete.push(p);
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
    xmp: xmp.size,
    xmpDelete: numXMPToDelete 
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

    // console.log(`Reading directory ${dir}. ${unreadDirectories.length} discovered, unsearched director${unreadDirectories.length == 1 ? "y" : "ies"} remaining`);
    process.stdout.write(`Number of discovered but unsearched directories remaining: ${unreadDirectories.length}${((unreadDirectories.length + 1).toString().length - (unreadDirectories.length).toString().length)?" ": ""}\r`); //Won't write a new line every time. Adds a space if the number of digits of the number changes

    let files = [];

    fs.readdirSync(dir).forEach(p => {
      p = path.join(dir, p);
      if (fs.statSync(p).isDirectory() && !p.endsWith(".lrdata")) {
        //lrdata has a lot of directories, so avoid scanning those
        unreadDirectories.push(p);
      }
      else {
        if (fileMatchesExtensionWhitelist(p, extensionWhitelist)) {
          let lowercase = lowercaseExtension(p);
          files.push(lowercase);
          allFiles.push(lowercase);
        }
      }
    });
    unreadDirectories.splice(0, 1); //Remove the scanned directory
  
    let deletions = findFilesToDelete(files); //look at the files in that directory and search for those that need to be deleted.

    if (deletions.xmpDelete || deletions.rawDelete) {
      deletions.directory = dir;
      overviewOfDeletions.push(deletions);
    }
  }

  console.timeEnd(labelSearchTime);
  

  let nRAW, nRAWD, nXMP, nXMPD;
  nRAW = nRAWD = nXMP = nXMPD = 0;
  console.log(`\n\nDeleting from the following directories:`);
  console.log(`| Directory name | No. RAW | No. RAW to delete | No. XMP | No. XMP to delete |`);
  overviewOfDeletions.forEach(obj => {
    console.log(`| ${path.relative(baseDirectory, obj.directory)} | ${obj.raw} | ${obj.rawDelete} | ${obj.xmp} | ${obj.xmpDelete} |`);
    nRAW += obj.raw; nRAWD += obj.rawDelete; nXMP += obj.xmp; nXMPD += obj.xmpDelete;
  });
  console.log(`| Total | ${nRAW} | ${nRAWD} | ${nXMP} | ${nXMPD} |`);
  console.log("\n\n");

  
  console.log(`Total of ${filterByExtension(allFiles, rawExt).length} RAW files found, ${filterByExtension(filesToDelete, rawExt).length} marked for deletion.`);
  console.log(`Total of ${filterByExtension(allFiles, xmpExt).length} XMP files found, ${filterByExtension(filesToDelete, xmpExt).length} marked for deletion.`);

  // console.log(JSON.stringify(filesToDelete));

  console.time(labelSumFileSizes);
  let sum = findTotalFileSize();
  console.timeEnd(labelSumFileSizes);
  console.log(`Total size of all files marked for deletion: ${sum} bytes / ${Math.round(sum / 1024)}KB / ${Math.round(sum / (Math.pow(1024, 2)))}MB / ${Math.round(sum / (Math.pow(1024, 3)))}GB`);

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
      trash(filesToDelete).then(() => {
        console.log(`${filesToDelete.length} files sent to trash`);
      }).catch(err => {
        console.log(`Error deleting files`);
        console.log(err);
      })
    }
    else {
      filesToDelete.forEach(p => {
         fs.unlinkSync(p);
      });
      console.log(`${filesToDelete.length} files deleted`);
    }
  }

  else console.log("Deletion cancelled");
});

