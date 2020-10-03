import * as fs from "fs";
import converter from "xml-js";

const outputPath = "../output";
const filesPath = `${outputPath}/structures`;
const resultFile = fs.readFileSync(`${outputPath}/RESULTS.xml`, "utf8");
const results = JSON.parse(
  converter.xml2json(resultFile, { compact: true, ignoreComment: true })
);

const junctions = [];
results.File.PDB_Structure.forEach((pdb) => {
  if (!pdb.Junction) return;
  if (Array.isArray(pdb.Junction)) {
    junctions.push(...pdb.Junction);
  } else {
    junctions.push(pdb.Junction);
  }
});
console.log("Input files:", junctions.length);

const corrupted = [];
junctions.map(
  (junction) =>
    new Promise((resolve, reject) => {
      const filename = junction.field2._text.trim();
      const sequence = junction.field4._text.split("-").join("").toUpperCase();
      const length = sequence.length;
      const boundaries = filename
        .substring(0, filename.length - 4) // remove .cif
        .split("_")
        .slice(3);
      const ranges = boundaries
        .map((v, index) => {
          if (index % 2) return;
          return { start: v, end: boundaries[index + 1] };
        })
        .filter((v) => v);
      const file = String(fs.readFileSync(`${filesPath}/${filename}`)).split(
        "\n"
      );
      const columns = file.filter((v) => v.startsWith("_atom_site"));
      const compColumnIndex = columns.indexOf("_atom_site.label_comp_id");
      const chainColumnIndex = columns.indexOf("_atom_site.auth_asym_id");
      const indexColumnIndex = columns.indexOf("_atom_site.auth_seq_id");
      const insColumnIndex = columns.indexOf("_atom_site.pdbx_PDB_ins_code");
      let residues = new Set();
      file
        .filter((v) => v.startsWith("ATOM") || v.startsWith("HETATM"))
        .map((v) => {
          const columns = v.split(/\s+/);
          const residue = {
            comp: columns[compColumnIndex],
            chain: columns[chainColumnIndex],
            index: columns[indexColumnIndex],
            ins: columns[insColumnIndex],
          };
          if (!residues.has(JSON.stringify(residue))) {
            residues.add(JSON.stringify(residue));
          }
        });
      residues = Array.from(residues).map((v) => JSON.parse(v));
      try {
        if (residues.length !== length) {
          throw { code: 1 };
        }
        if (sequence !== residues.map((v) => v.comp).join("")) {
          throw { code: 2 };
        }
        const residuesRangeFormat = residues.map((v) =>
          [v.chain, v.index].join("-")
        );
        ranges.forEach((range) => {
          if (
            residuesRangeFormat.lastIndexOf(range.start) === -1 ||
            residuesRangeFormat.lastIndexOf(range.end) === -1
          ) {
            throw { code: 3, message: `${range.start} or ${range.end}` };
          } else if (
            residuesRangeFormat.lastIndexOf(range.start) >
            residuesRangeFormat.lastIndexOf(range.end)
          ) {
            throw { code: 4, message: `${range.start} > ${range.end}` };
          }
        });
        residues.forEach((_residue, index) => {
          let inRange = false;
          ranges.forEach((range) => {
            if (
              index >= residuesRangeFormat.indexOf(range.start) &&
              index <= residuesRangeFormat.lastIndexOf(range.end)
            ) {
              inRange = true;
            }
          });
          if (!inRange) {
            throw { code: 5, message: `${residuesRangeFormat[index]}` };
          }
        });
      } catch (err) {
        switch (err.code) {
          case 1:
            corrupted.push(
              `Different length: file(${residues.length}), junction(${length}) -- ${filename}`
            );
            break;
          case 2:
            corrupted.push(`Different sequence -- ${filename}`);
            break;
          case 3:
            corrupted.push(
              `Range boundary not in file (${err.message}) -- ${filename}`
            );
            break;
          case 4:
            corrupted.push(
              `Corrupted range boundaries (${err.message}) -- ${filename}`
            );
            break;
          case 5:
            corrupted.push(
              `Residue ${err.message} not in ranges -- ${filename}`
            );
            break;
        }
      }
      resolve();
    })
);

Promise.all(junctions).then(() => {
  console.log("Corrupted:", corrupted.length);
  fs.writeFileSync("corrupted.txt", corrupted.sort().join("\n"));
});
