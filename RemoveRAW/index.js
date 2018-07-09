/*
This tool deletes RAW files that haven't been edited. This is guessed through the presence of a XMP sidecar file produced by Lightroom or a similar program. 
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

let filesToDelete, allFiles, unreadDirectories, deletionType;
filesToDelete = [];
allFiles = [];

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

// Finds the total file size of files marked for deletion
let findTotalFileSize = () => filesToDelete.reduce((prev, curr) => prev + fs.statSync(curr).size, 0);

//For an array of files, it marks files for deletion
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


    /*
    deletionType: 0
      CR2: deleted
      CR2, XMP: not deleted
      CR2, XMP, JPG: not deleted
      CR2, JPG: not deleted

    deletionType: 1
      CR2: deleted
      CR2, XMP: deleted
      CR2, XMP, JPG: not deleted
      CR2, JPG: not deleted
    */
    switch (deletionType) {
      case 0:
        if (!(xmpFound || jpgFound)) {
          filesToDelete.push(p);
          numRAWToDelete++;
        }
        break;
      case 1:
        if (!(jpegFound || jpgFound)) {
          //Delete if no jpeg found
          filesToDelete.push(p);
          numRAWToDelete++;

          if (xmpFound) {
            //If xmp found, delete that too
            filesToDelete.push(xmpF);
            numXMPToDelete++;
          }
        }
        break;
    }
  });
  if (numRAWToDelete) console.log(`${numRAWToDelete} out of ${raw.length} RAW files marked for deletion`); //Don't print if none found 
  if (numXMPToDelete) console.log(`${numXMPToDelete} out of ${xmp.size} XMP files marked for deletion`);
}



console.log("This tool deletes RAW files that don't have associated XMP sidecar files of the same name (in the same directory)");
inquirer.prompt([
  {
    type: "input",
    name: "baseDirectory",
    message: "Enter directory to search",
    validate: dir => fs.existsSync(dir)?true: "Could not find the given directory"
  },
  {
    type: "list",
    name: "deletionType",
    message: "If these files exist",
    choices: [{
      name: `
CR2: deleted
CR2, XMP: not deleted
CR2, XMP, JPG: not deleted
CR2, JPG: not deleted`,
      value: 0
     }, {
       name: `
CR2: deleted
CR2, XMP: deleted
CR2, XMP, JPG: not deleted
CR2, JPG: not deleted`,
      value: 1
     }]
  }
]).then(answers => {
  unreadDirectories = [answers.baseDirectory]; //Start off with one directory to search
  deletionType = answers.deletionType;
  
  let extensionWhitelist = [rawExt, jpgExt, jpegExt, xmpExt];
  console.time(labelSearchTime);
  while (unreadDirectories.length) {
    console.log(`Reading directory ${unreadDirectories[0]}. ${unreadDirectories.length} director${unreadDirectories.length == 1 ? "y" : "ies"} to search remaining`);
    let files = [];
    fs.readdirSync(unreadDirectories[0]).forEach(p => {
      p = path.join(unreadDirectories[0], p);
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
  
    findFilesToDelete(files); //look at the files in that directory and search for those that need to be deleted.
  }
  
  console.log(`
  
  Total of ${filterByExtension(allFiles, rawExt).length} RAW files found, ${filterByExtension(filesToDelete, rawExt).length} marked for deletion.
  Total of ${filterByExtension(allFiles, xmpExt).length} XMP files found, ${filterByExtension(filesToDelete, xmpExt).length} marked for deletion.
  
  `);

  console.time(labelSumFileSizes);
  let sum = findTotalFileSize();
  console.timeEnd(labelSumFileSizes);
  console.log(`Total size of all files marked for deletion: ${sum} bytes / ${Math.round(sum / 1024)}KB / ${Math.round(sum / (1024 * 1024))}MB / ${Math.round(sum / (Math.pow(1024, 3)))}GB`);

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
