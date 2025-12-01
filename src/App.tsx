import React, { useState, useEffect } from "react";
import {
  Camera,
  FileSpreadsheet,
  Download,
  ScanLine,
  CheckCircle,
  ChevronRight,
  Settings,
  Loader2,
  ArrowLeft,
  Trash2,
  UploadCloud,
  Edit3,
} from "lucide-react";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

// --- CONFIG ---
const ROBOFLOW_MODEL_ID = "find-kvps-mrs-times-and-hvls/1";

// --- LOGIC FUNCTIONS ---

const parseExcel = (file: File, callback: (data: any[]) => void) => {
  const reader = new FileReader();
  reader.onload = (evt) => {
    const arrayBuffer = evt.target?.result;
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];

    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
      if (
        rawData[i] &&
        rawData[i].some(
          (cell: any) => cell && cell.toString().includes("Inspection Number")
        )
      ) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      alert(
        "Could not find header row 'Inspection Number'. Check Excel format."
      );
      return;
    }

    const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });
    callback(data);
  };
  reader.readAsArrayBuffer(file);
};

const createWordDoc = (
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
    const out = doc
      .getZip()
      .generate({
        type: "blob",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    saveAs(out, filename);
  } catch (error) {
    console.error(error);
    alert("Error generating document. Check template tags.");
  }
};

// GRID PARSER: Extracts numbers based on POSITION
const extractGridValues = (textBlocks: any[]): number[] => {
  // textBlocks is array of { text: "...", x: ..., y: ... }

  // 1. Filter for valid decimal numbers
  const validBlocks = textBlocks.filter((block) => {
    let txt = block.text;
    // Exclude rate units, dates, page numbers
    if (txt.includes("/s") || txt.includes("/min")) return false;
    if (txt.includes("/")) return false;
    if (txt.includes("of")) return false;
    // Must be a decimal number
    return /\d+\.\d+/.test(txt);
  });

  // 2. Sort Spatially
  // Y-coordinate primary (Row), X-coordinate secondary (Column)
  validBlocks.sort((a, b) => {
    const yDiff = a.y - b.y;
    // If Y difference is small (< 20px), consider them on same line
    if (Math.abs(yDiff) > 20) return yDiff;
    return a.x - b.x;
  });

  // 3. Extract Numbers
  return validBlocks
    .map((block) => {
      const match = block.text.match(/(\d+\.?\d*)/);
      return match ? parseFloat(match[0]) : NaN;
    })
    .filter((n) => !isNaN(n));
};

// --- MAIN COMPONENT ---

type Machine = {
  id: string;
  fullDetails: string;
  type: string;
  location: string;
  registrantName: string;
  data: { [key: string]: string };
  isComplete: boolean;
};

const DENTAL_STEPS = [
  {
    id: "scan1",
    label: "1. Technique Scan",
    desc: "Order: kVp, Dose, Time, HVL",
    fields: ["kvp", "mR1", "time1", "hvl"],
    indices: [0, 1, 2, 3],
  },
  {
    id: "scan2",
    label: "2. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR2", "time2"],
    indices: [1, 2],
  },
  {
    id: "scan3",
    label: "3. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR3", "time3"],
    indices: [1, 2],
  },
  {
    id: "scan4",
    label: "4. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR4", "time4"],
    indices: [1, 2],
  },
  {
    id: "scan5",
    label: "5. Scatter (6ft)",
    desc: "Order: Dose (2nd)",
    fields: ["6 foot"],
    indices: [1],
  },
  {
    id: "scan6",
    label: "6. Scatter (Operator)",
    desc: "Order: Dose (2nd)",
    fields: ["operator location"],
    indices: [1],
  },
];

export default function RayScanLocal() {
  const [view, setView] = useState<
    "dashboard" | "mobile-list" | "mobile-form" | "settings"
  >("dashboard");
  const [apiKey, setApiKey] = useState(""); // Roboflow API Key
  const [machines, setMachines] = useState<Machine[]>([]);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [templateFile, setTemplateFile] = useState<ArrayBuffer | null>(null);
  const [templateName, setTemplateName] =
    useState<string>("No Template Loaded");
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedText, setLastScannedText] = useState<string>("");
  const [lastParsedNumbers, setLastParsedNumbers] = useState<number[]>([]);

  useEffect(() => {
    if (!document.getElementById("tailwind-script")) {
      const script = document.createElement("script");
      script.src = "https://cdn.tailwindcss.com";
      script.id = "tailwind-script";
      document.head.appendChild(script);
    }
    const savedKey = localStorage.getItem("rayScanRoboflowKey");
    const savedMachines = localStorage.getItem("rayScanMachines");
    if (savedKey) setApiKey(savedKey);
    if (savedMachines) setMachines(JSON.parse(savedMachines));
  }, []);

  useEffect(() => {
    localStorage.setItem("rayScanMachines", JSON.stringify(machines));
  }, [machines]);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    localStorage.setItem("rayScanRoboflowKey", e.target.value);
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTemplateName(file.name);
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result)
          setTemplateFile(evt.target.result as ArrayBuffer);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const clearTemplate = () => {
    setTemplateFile(null);
    setTemplateName("No Template Loaded");
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    parseExcel(file, (data) => {
      const newMachines: Machine[] = data
        .filter((row: any) => row["Entity Name"] && row["Inspection Number"])
        .filter((row: any) => {
          const name = row["Entity Name"] || "";
          return name.includes("(") && name.includes(")");
        })
        .map((row: any, index: number) => {
          const rawString = row["Entity Name"] || "";
          let fullDetails = "Unknown Machine";
          let facility = rawString;

          if (rawString.includes("(") && rawString.includes(")")) {
            const parts = rawString.split("(");
            facility = parts[0].trim();
            fullDetails = parts[1].replace(")", "");
          }

          return {
            id: `mach_${Date.now()}_${index}`,
            fullDetails: fullDetails,
            type: row["Credential Type"] || row["Inspection Form"] || "Unknown",
            location: row["Credential #"] || facility,
            registrantName: facility,
            data: {},
            isComplete: false,
          };
        });

      if (newMachines.length === 0) alert("No machines found.");
      else {
        setMachines(newMachines);
        alert(`Loaded ${newMachines.length} machines.`);
      }
    });
  };

  // --- ROBOFLOW API CALL ---
  const performRoboflowScan = async (
    base64Image: string,
    targetFields: string[],
    indices: number[]
  ) => {
    if (!apiKey) {
      alert("Set Roboflow API Key first!");
      return;
    }
    setIsScanning(true);
    try {
      const imageContent = base64Image.split(",")[1]; // Raw base64

      // Roboflow Inference Endpoint
      const endpoint = `https://detect.roboflow.com/${ROBOFLOW_MODEL_ID}?api_key=${apiKey}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: imageContent,
      });

      const result = await response.json();

      if (result.error) throw new Error(result.error.message);

      // PARSE ROBOFLOW RESPONSE
      // Looking for "output_google_vision_ocr" inside the response array
      let textBlocks: any[] = [];
      const resultArray = Array.isArray(result) ? result : [result];
      const ocrData = resultArray.find((r: any) => r.output_google_vision_ocr);

      if (ocrData && ocrData.output_google_vision_ocr) {
        // Flatten predictions: extract text, x, y
        textBlocks = ocrData.output_google_vision_ocr.flatMap((item: any) => {
          // item.text is the string. item.predictions.predictions[0] has coords.
          // Sometimes predictions array might be empty or structured differently.
          // We handle the structure shown in your snippet.
          const preds = item.predictions?.predictions || [];
          return preds.map((pred: any) => ({
            text: item.text, // The text string (e.g. "2.80")
            x: pred.x,
            y: pred.y,
          }));
        });
      }

      if (textBlocks.length === 0) {
        setLastScannedText("No text found in Roboflow response.");
        alert(
          "Roboflow returned no OCR data. Ensure your model includes the OCR step."
        );
        return;
      }

      // 2. EXTRACT & SORT
      const sortedNumbers = extractSortedValues(textBlocks);
      setLastParsedNumbers(sortedNumbers);
      setLastScannedText(sortedNumbers.join(", "));

      // 3. MAP TO FIELDS
      const updates: Record<string, string> = {};
      targetFields.forEach((field, i) => {
        const indexToGrab = indices[i];
        if (sortedNumbers[indexToGrab] !== undefined) {
          updates[field] = sortedNumbers[indexToGrab].toString();
        }
      });

      if (Object.keys(updates).length > 0) {
        if (activeMachineId) {
          setMachines((prev) =>
            prev.map((m) =>
              m.id === activeMachineId
                ? { ...m, data: { ...m.data, ...updates } }
                : m
            )
          );
        }
      } else {
        alert(
          `No valid decimals found.\nIndices: [${indices}]\nFound: ${sortedNumbers.join(
            ", "
          )}`
        );
      }
    } catch (e: any) {
      alert("Scan Error: " + e.message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanClick = (
    e: React.ChangeEvent<HTMLInputElement>,
    fields: string[],
    indices: number[]
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        performRoboflowScan(reader.result as string, fields, indices);
      reader.readAsDataURL(file);
    }
  };

  const updateField = (key: string, value: string) => {
    if (!activeMachineId) return;
    setMachines((prev) =>
      prev.map((m) =>
        m.id === activeMachineId
          ? { ...m, data: { ...m.data, [key]: value } }
          : m
      )
    );
  };

  const generateDoc = (machine: Machine) => {
    if (!templateFile) {
      alert("Upload Template first!");
      return;
    }
    const data = {
      inspector: "RH",
      "make model serial": machine.fullDetails,
      "registration number": machine.location,
      "registrant name": machine.registrantName,
      date: new Date().toLocaleDateString(),
      "tube number": machine.data["tube_num"] || "1",
      "preset kvp": machine.data["preset_kvp"] || "",
      "preset mas": machine.data["preset_mas"] || "",
      "preset time": machine.data["preset_time"] || "",
      details: machine.fullDetails,
      credential: machine.location,
      type: machine.type,
      ...machine.data,
    };
    createWordDoc(templateFile, data, `Inspection_${machine.location}.docx`);
    setMachines((prev) =>
      prev.map((m) => (m.id === machine.id ? { ...m, isComplete: true } : m))
    );
  };

  const clearAll = () => {
    if (window.confirm("Delete all?")) {
      setMachines([]);
      localStorage.removeItem("rayScanMachines");
    }
  };
  const activeMachine = machines.find((m) => m.id === activeMachineId);

  if (view === "settings")
    return (
      <div className="min-h-screen bg-slate-50 p-6 font-sans">
        <button
          onClick={() => setView("dashboard")}
          className="mb-6 flex gap-2 font-bold"
        >
          <ArrowLeft /> Back
        </button>
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <input
          className="w-full border p-3 mb-4 rounded"
          placeholder="Roboflow API Key"
          value={apiKey}
          onChange={handleApiKeyChange}
          type="password"
        />
        <div className="border-2 border-dashed p-6 text-center rounded relative">
          <label className="block w-full h-full cursor-pointer">
            {templateName}
            <input
              type="file"
              accept=".docx"
              onChange={handleTemplateUpload}
              className="hidden"
            />
          </label>
          {templateFile && (
            <button
              onClick={clearTemplate}
              className="absolute top-2 right-2 p-1 bg-red-100 text-red-600 rounded-full"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    );

  if (view === "mobile-list")
    return (
      <div className="min-h-screen bg-slate-100 pb-20 font-sans">
        <header className="bg-blue-900 text-white p-4 flex justify-between">
          <h1 className="font-bold">My Inspections</h1>
          <button
            onClick={() => setView("dashboard")}
            className="text-xs bg-white/20 px-2 rounded"
          >
            Exit
          </button>
        </header>
        <div className="p-4 space-y-2">
          {machines.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setActiveMachineId(m.id);
                setView("mobile-form");
              }}
              className="bg-white p-4 rounded shadow flex justify-between items-center"
            >
              <div>
                <div className="font-bold text-lg text-blue-900">
                  {m.location}
                </div>
                <div className="text-xs text-slate-500">{m.fullDetails}</div>
              </div>
              <ChevronRight />
            </div>
          ))}
        </div>
      </div>
    );

  if (view === "mobile-form" && activeMachine) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24 font-sans">
        <header className="bg-white p-4 border-b sticky top-0 z-10">
          <div className="flex gap-3 items-center mb-1">
            <button onClick={() => setView("mobile-list")}>
              <ArrowLeft />
            </button>
            <div className="font-bold text-lg">{activeMachine.location}</div>
          </div>
          <div className="text-xs text-slate-500 ml-9">
            {activeMachine.fullDetails}
          </div>
        </header>
        <div className="p-4 space-y-6">
          <div className="bg-blue-50 p-4 rounded border border-blue-100 shadow-sm">
            <h3 className="font-bold text-blue-800 text-sm mb-3 uppercase tracking-wide">
              Machine Settings
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Tube #
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="1"
                  value={activeMachine.data["tube_num"] || ""}
                  onChange={(e) => updateField("tube_num", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Preset kVp
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="70"
                  value={activeMachine.data["preset_kvp"] || ""}
                  onChange={(e) => updateField("preset_kvp", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Preset mAs
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="10"
                  value={activeMachine.data["preset_mas"] || ""}
                  onChange={(e) => updateField("preset_mas", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Preset Time
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="0.10"
                  value={activeMachine.data["preset_time"] || ""}
                  onChange={(e) => updateField("preset_time", e.target.value)}
                />
              </div>
            </div>
          </div>

          {lastScannedText && (
            <div className="bg-slate-100 p-2 rounded text-[10px] font-mono text-slate-500 mb-2 overflow-hidden">
              <div className="font-bold mb-1">
                Detected: {JSON.stringify(lastParsedNumbers)}
              </div>
              <div className="truncate text-slate-400">{lastScannedText}</div>
            </div>
          )}

          {DENTAL_STEPS.map((step) => (
            <div
              key={step.id}
              className="bg-white p-4 rounded border shadow-sm"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-sm text-blue-900">
                    {step.label}
                  </div>
                  <div className="text-[10px] text-slate-400">{step.desc}</div>
                </div>
                <label className="bg-blue-600 text-white px-3 py-2 rounded text-xs font-bold cursor-pointer flex gap-1 items-center shadow-sm active:scale-95 transition-transform">
                  {isScanning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ScanLine size={14} />
                  )}{" "}
                  Scan
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) =>
                      handleScanClick(e, step.fields, step.indices)
                    }
                    disabled={isScanning}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {step.fields.map((k) => (
                  <div key={k}>
                    <label className="text-[9px] font-bold text-slate-400 uppercase">
                      {k}
                    </label>
                    <div className="relative">
                      <input
                        value={activeMachine.data[k] || ""}
                        onChange={(e) => updateField(k, e.target.value)}
                        className="w-full font-mono text-lg border-b outline-none bg-transparent"
                        placeholder="-"
                      />
                      <Edit3 className="absolute right-0 top-1 text-slate-200 h-3 w-3 pointer-events-none" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="fixed bottom-0 w-full p-4 bg-white border-t">
          <button
            onClick={() => generateDoc(activeMachine)}
            className="w-full py-3 bg-emerald-600 text-white font-bold rounded shadow flex justify-center gap-2"
          >
            <Download /> Save Report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans">
      <header className="flex justify-between mb-6">
        <div className="flex gap-2 items-center">
          <ScanLine className="text-blue-600" />
          <h1 className="text-xl font-bold">RayScan</h1>
        </div>
        <button onClick={() => setView("settings")}>
          <Settings />
        </button>
      </header>
      <div className="bg-white p-6 rounded shadow text-center mb-4">
        <div className="text-4xl font-bold text-blue-600 mb-4">
          {machines.length}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="bg-slate-100 p-3 rounded cursor-pointer font-bold text-sm">
            Import Excel
            <input
              type="file"
              accept=".xlsx"
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>
          <button
            onClick={() => setView("mobile-list")}
            className="bg-blue-600 text-white p-3 rounded font-bold text-sm"
          >
            Start Scan
          </button>
        </div>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <div className="p-3 bg-slate-50 border-b flex justify-between font-bold text-xs uppercase">
          <span>Machines</span>
          <button onClick={clearAll}>
            <Trash2 size={14} className="text-red-500" />
          </button>
        </div>
        {machines.map((m) => (
          <div
            key={m.id}
            className="p-3 border-b flex justify-between items-center"
          >
            <div>
              <div className="font-bold text-sm">{m.location}</div>
              <div className="text-xs text-slate-500">{m.fullDetails}</div>
            </div>
            {m.isComplete && (
              <CheckCircle className="text-emerald-500" size={16} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
