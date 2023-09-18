const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { Readable } = require("stream");
const { finished } = require("stream/promises");
const inquirer = require("inquirer");
const { join } = require("path");

function getTempDir() {
  const path = join(__dirname, "Temp");
  if (!fs.existsSync(path)) fs.mkdirSync(path);
  return path;
}
function getImages(harFilePath, imageIdentification) {
  const urls = [];
  JSON.parse(fs.readFileSync(harFilePath, "utf8"))
    .log.entries.filter(
      (el) =>
        el._initiator.type == "parser" &&
        el.request.url.includes(imageIdentification),
    )
    .forEach((el) => {
      urls.push(el.request.url);
    });
  return urls;
}

async function saveImages(imageUrls) {
  const imageNames = [];
  const tempDir = getTempDir();

  let counter = 1;
  for (const img of imageUrls) {
    const name = String(counter) + ".jpg";
    imageNames.push(tempDir + "/" + name);

    const stream = fs.createWriteStream(`${tempDir}/${name}`);
    const { body } = await fetch(img).catch((err) => console.error);
    await finished(Readable.fromWeb(body).pipe(stream));
    await new Promise((r) => setTimeout(r, 50));
    counter++;
  }
  return imageNames;
}

async function createPDF(imagePaths, orientation, pdfName) {
  // orientation : true = portrait, false = paysage

  // Dimensions de la page en paysage (A4 par défaut)
  const pageWidth = orientation ? 595 : 842; // Largeur de la page en points
  const pageHeight = orientation ? 842 : 595; // Hauteur de la page en points
  const outputPath = pdfName;

  const pdfDoc = await PDFDocument.create();
  const orderedImagePaths = [];

  if (orientation) {
    for (let i = 0; i < imagePaths.length; i += 1) {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const imageWidth = pageWidth;
      const imageHeight = pageHeight;

      const imagePath = imagePaths[i];

      // Charger l'image depuis le fichier
      const imageBytes = fs.readFileSync(imagePath);

      // Ajouter l'image à la page
      const image = await pdfDoc.embedJpg(imageBytes);
      page.drawImage(image, {
        x: 0, // Position horizontale de l'image
        y: 0, // Position verticale de l'image (en haut de la page)
        width: imageWidth, // Largeur de l'image
        height: imageHeight, // Hauteur de l'image
      });
    }
  } else {
    for (let i = 1; i < imagePaths.length; i += 2) {
      orderedImagePaths.push([imagePaths[i], imagePaths[i + 1]]);
    }

    {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const imageWidth = pageWidth / 2;
      const imageHeight = pageHeight;

      const imagePath = imagePaths[0];

      // Charger l'image depuis le fichier
      const imageBytes = fs.readFileSync(imagePath);

      // Ajouter l'image à la page
      const image = await pdfDoc.embedJpg(imageBytes);
      page.drawImage(image, {
        x: 1 * imageWidth, // Position horizontale de l'image
        y: 0, // Position verticale de l'image (en haut de la page)
        width: imageWidth, // Largeur de l'image
        height: imageHeight, // Hauteur de l'image
      });
    }

    for (let i = 0; i < orderedImagePaths.length; i++) {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const imageWidth = pageWidth / 2;
      const imageHeight = pageHeight;

      for (let j = 0; j < 2; j++) {
        if (i === orderedImagePaths.length - 1 && j === 1) continue;

        const imageBytes = fs.readFileSync(orderedImagePaths[i][j]);
        const image = await pdfDoc.embedJpg(imageBytes);
        page.drawImage(image, {
          x: j * imageWidth, // Position horizontale de l'image
          y: 0, // Position verticale de l'image (en haut de la page)
          width: imageWidth, // Largeur de l'image
          height: imageHeight, // Hauteur de l'image
        });
      }
    }
  }

  // Enregistrer le document PDF dans un fichier
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
  return outputPath;
}

fs.rmSync(getTempDir(), { recursive: true });

// Définir la question pour le fichier .har
const harFileQuestion = {
  type: "input",
  name: "harFilePath",
  message: "Veuillez spécifier le chemin vers le fichier .har :",
  // ajouter un regex pour vérifier que le fichier est bien un .har

  validate: function (input) {
    // Vérifier si le fichier existe
    if (!input.endsWith(".har")) {
      return "Veuillez entrer un fichier .har";
    } else if (fs.existsSync(input)) {
      return true;
    } else {
      return "Le fichier spécifié n'existe pas. Veuillez entrer un chemin valide.";
    }
  },
  default: "requetes2.har",
};

const imageIdentificator = {
  // Demander quel est le point de repère pour identifier un fichier image dans l'historique, comme "Page_"
  type: "input",
  name: "imageIdentification",
  message:
    "Veuillez spécifier le point de repère pour identifier un fichier image dans l'historique :",
  default: "Page_",
};

const pdfNameQuestion = {
  type: "input",
  name: "pdfName",
  message: "Veuillez spécifier le préfixe du nom du fichier PDF :",
  default: "manuel",
};

const pdfOrientationQuestion = {
  type: "list",
  name: "pdfOrientation",
  message: "Veuillez spécifier l'orientation du PDF :",
  choices: ["Portrait", "Paysage", "Les deux"],
  default: "Portrait",
};

// Demander si on démarre le téléchargement des images
const doDownloadImages = {
  type: "confirm",
  name: "downloadImages",
  message: "Voulez-vous télécharger les images ?",
  default: true,
};

async function main() {
  const ui = new inquirer.ui.BottomBar();

  const harFilePath = await inquirer
    .prompt(harFileQuestion)
    .then((answers) => answers.harFilePath);
  const imageIdentification = await inquirer
    .prompt(imageIdentificator)
    .then((answers) => answers.imageIdentification);
  const imagesUrl = getImages(harFilePath, imageIdentification);
  console.log(imagesUrl[0]);
  ui.log.write(`Nombre d'images trouvées : ${imagesUrl.length}`);

  const downloadImagesAnswer = await inquirer
    .prompt(doDownloadImages)
    .then((answers) => answers.downloadImages);

  if (!downloadImagesAnswer) return;

  // write dots while waiting for the images to be downloaded
  ui.log.write("Téléchargement des images (peut prendre plusieurs minutes) ");

  const imagesPaths = await saveImages(imagesUrl);

  ui.log.write("Images téléchargées avec succès !");

  const pdfName = await inquirer
    .prompt(pdfNameQuestion)
    .then((answers) => answers.pdfName);
  const pdfOrientation = await inquirer
    .prompt(pdfOrientationQuestion)
    .then((answers) => answers.pdfOrientation);

  ui.log.write("Création du/des PDF ");

  if (pdfOrientation === "Portrait") {
    await createPDF(imagesPaths, true, `${pdfName}_portrait.pdf`);
  } else if (pdfOrientation === "Paysage") {
    await createPDF(imagesPaths, false, `${pdfName}_paysage.pdf`);
  } else {
    await createPDF(imagesPaths, true, `${pdfName}_portrait.pdf`);
    await createPDF(imagesPaths, false, `${pdfName}_paysage.pdf`);
  }

  ui.log.write("PDF créé(s) avec succès !");
}

main().catch((err) => console.error(err));
