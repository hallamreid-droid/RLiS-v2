import * as XLSX from "xlsx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

export const parseExcel = (file: File, callback: (data: any[]) => void) => {
  const reader = new FileReader();
  reader.onload = (evt) => {
    const arrayBuffer = evt.target?.result;
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];

    // Header Hunter: Find the row with "Inspection Number"
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
      if (rawData[i] && rawData[i].includes("Inspection Number")) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      alert("Could not find header row.");
      return;
    }

    const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });
    callback(data);
  };
  reader.readAsArrayBuffer(file);
};

export const createWordDoc = (
  templateBuffer: ArrayBuffer,
  data: any,
  filename: string
) => {
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render(data);
    const out = doc.getZip().generate({
      type: "blob",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    saveAs(out, filename);
  } catch (error) {
    console.error(error);
    alert("Error generating document.");
  }
};
