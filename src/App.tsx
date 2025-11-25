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

// --- LOGIC FUNCTIONS (Internalized) ---

const parseExcel = (file: File, callback: (data: any[]) => void) => {
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

// SMART PARSER: Extracts numbers based on INDEX (Position)
const extractGridValues = (text: string): number[] => {
  // 1. Remove Page Numbers (e.g. "2 of 26", "8/8", "Page 1")
  let cleanText = text.replace(/\b\d+\s+(of|af)\s+\d+\b/gi, " ");
  cleanText = cleanText.replace(/\b\d+\/\d+\b/gi, " ");
  cleanText = cleanText.replace(/Page\s+\d+/gi, " ");

  // 2. Remove rate units that confuse logic (e.g. /s, /min)
  cleanText = cleanText.replace(/\/\s*[sm]/gi, "");

  // 3. Find all numbers (integers or decimals)
  const numberPattern = /(\d+\.?\d*)/g;
  const matches = cleanText.match(numberPattern);

  if (!matches) return [];

  // 4. Filter out any remaining obvious non-measurements
  return matches.map(parseFloat).filter((n) => !isNaN(n));
};

// --- MAIN COMPONENT ---

type Machine = {
  id: string;
  make: string;
  model: string;
  serial: string;
  type: string;
  location: string;
  data: { [key: string]: string };
  isComplete: boolean;
};

// Updated Fields for Dental Steps
// We add an 'indices' array to tell the app WHICH numbers to grab from the list
// RaySafe Grid Order Assumption: [0: kVp] [1: Dose] [2: Time] [3: HVL]
// Note: This order assumes Left->Right, Top->Bottom reading. If your RaySafe is different, swap these indices!
const DENTAL_STEPS = [
  {
    id: "scan1",
    label: "1. Technique Scan",
    desc: "Capture kVp, Dose, Time, HVL",
    fields: ["kvp", "mR1", "time1", "hvl"],
    indices: [0, 1, 2, 3], // Grab 1st, 2nd, 3rd, 4th numbers
  },
  {
    id: "scan2",
    label: "2. Reproducibility",
    desc: "Capture Time, Dose (Skip kVp)",
    fields: ["time2", "mR2"],
    indices: [2, 1], // Skip 0 (kVp). Grab 3rd (Time) and 2nd (Dose).
    // Note: Adjust this if Time is 2nd on your screen!
  },
  {
    id: "scan3",
    label: "3. Reproducibility",
    desc: "Capture Time, Dose",
    fields: ["time3", "mR3"],
    indices: [2, 1],
  },
  {
    id: "scan4",
    label: "4. Reproducibility",
    desc: "Capture Time, Dose",
    fields: ["time4", "mR4"],
    indices: [2, 1],
  },
  {
    id: "scan5",
    label: "5. Scatter (6ft)",
    desc: "Capture Dose only",
    fields: ["6 foot"],
    indices: [1], // Just grab the Dose (2nd number usually)
  },
  {
    id: "scan6",
    label: "6. Scatter (Operator)",
    desc: "Capture Dose only",
    fields: ["operator location"],
    indices: [1],
  },
];

export default function RayScanLocal() {
  const [view, setView] = useState<
    "dashboard" | "mobile-list" | "mobile-form" | "settings"
  >("dashboard");
  const [apiKey, setApiKey] = useState("");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [templateFile, setTemplateFile] = useState<ArrayBuffer | null>(null);
  const [templateName, setTemplateName] =
    useState<string>("No Template Loaded");
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedText, setLastScannedText] = useState<string>("");

  // Force Styles
  useEffect(() => {
    if (!document.getElementById("tailwind-script")) {
      const script = document.createElement("script");
      script.src = "https://cdn.tailwindcss.com";
      script.id = "tailwind-script";
      document.head.appendChild(script);
    }
  }, []);

  // Load Data
  useEffect(() => {
    const savedKey = localStorage.getItem("rayScanApiKey");
    const savedMachines = localStorage.getItem("rayScanMachines");
    if (savedKey) setApiKey(savedKey);
    if (savedMachines) setMachines(JSON.parse(savedMachines));
  }, []);

  useEffect(() => {
    localStorage.setItem("rayScanMachines", JSON.stringify(machines));
  }, [machines]);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    localStorage.setItem("rayScanApiKey", e.target.value);
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
          let make = "Unknown";
          let model = "Unknown";
          let serial = "Unknown";
          let facility = rawString;

          if (rawString.includes("(") && rawString.includes(")")) {
            const parts = rawString.split("(");
            facility = parts[0].trim();
            const machineDetails = parts[1].replace(")", "");
            const details = machineDetails.split("-");

            if (details.length >= 3) {
              make = details[0].trim();
              model = details[1].trim();
              serial = details[2].trim();
            } else if (details.length === 2) {
              make = details[0].trim();
              model = details[1].trim();
            } else {
              make = machineDetails;
            }
          }

          return {
            id: `mach_${Date.now()}_${index}`,
            make,
            model,
            serial,
            type: row["Credential Type"] || row["Inspection Form"] || "Unknown",
            location: row["Credential #"] || facility,
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

  // --- SMART GRID SCAN LOGIC ---
  const performSmartScan = async (base64Image: string, step: any) => {
    if (!apiKey) {
      alert("Set API Key first!");
      return;
    }
    setIsScanning(true);
    try {
      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                image: { content: base64Image.split(",")[1] },
                features: [{ type: "TEXT_DETECTION" }],
              },
            ],
          }),
        }
      );
      const data = await response.json();
      const fullText = data.responses[0]?.fullTextAnnotation?.text || "";

      setLastScannedText(fullText);

      // 1. Extract numbers (filtering out page numbers)
      const numbers = extractGridValues(fullText);
      console.log("Found Numbers:", numbers);

      const updates: Record<string, string> = {};

      // 2. Map numbers using INDICES from the config
      // step.fields = ['time2', 'mR2']
      // step.indices = [2, 1]  <-- Means grab the 3rd number for Time, 2nd for Dose

      step.fields.forEach((field: string, i: number) => {
        const indexToGrab = step.indices[i];
        if (numbers[indexToGrab] !== undefined) {
          updates[field] = numbers[indexToGrab].toString();
        }
      });

      if (Object.keys(updates).length > 0) {
        if (activeMachineId) {
          setMachines((prev) =>
            prev.map((m) => {
              if (m.id !== activeMachineId) return m;
              return { ...m, data: { ...m.data, ...updates } };
            })
          );
        }
      } else {
        alert(`No numbers found in expected positions. OCR saw:\n${fullText}`);
      }
    } catch (e) {
      alert("OCR Error");
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanClick = (
    e: React.ChangeEvent<HTMLInputElement>,
    step: any
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => performSmartScan(reader.result as string, step);
      reader.readAsDataURL(file);
    }
  };

  const updateField = (key: string, value: string) => {
    if (!activeMachineId) return;
    setMachines((prev) =>
      prev.map((m) => {
        if (m.id !== activeMachineId) return m;
        return { ...m, data: { ...m.data, [key]: value } };
      })
    );
  };

  const generateDoc = (machine: Machine) => {
    if (!templateFile) {
      alert("Upload Template first!");
      return;
    }
    const data = {
      make: machine.make,
      model: machine.model,
      serial: machine.serial,
      location: machine.location,
      type: machine.type,
      ...machine.data,
    };
    createWordDoc(templateFile, data, `Inspection_${machine.serial}.docx`);
    setMachines((prev) =>
      prev.map((m) => (m.id === machine.id ? { ...m, isComplete: true } : m))
    );
  };

  const clearAll = () => {
    if (window.confirm("Delete all machines?")) {
      setMachines([]);
      localStorage.removeItem("rayScanMachines");
    }
  };

  const activeMachine = machines.find((m) => m.id === activeMachineId);

  // --- UI ---
  if (view === "settings")
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <button
          onClick={() => setView("dashboard")}
          className="mb-6 flex gap-2 font-bold"
        >
          <ArrowLeft /> Back
        </button>
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <input
          className="w-full border p-3 mb-4 rounded"
          placeholder="API Key"
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
              className="absolute top-2 right-2 p-1 bg-red-100 text-red-600 rounded-full hover:bg-red-200"
              title="Remove Template"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    );

  if (view === "mobile-list")
    return (
      <div className="min-h-screen bg-slate-100 pb-20">
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
                <div className="font-bold">{m.location}</div>
                <div className="text-xs text-slate-500">{m.make}</div>
              </div>
              <ChevronRight />
            </div>
          ))}
        </div>
      </div>
    );

  if (view === "mobile-form" && activeMachine) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <header className="bg-white p-4 border-b flex gap-3 items-center sticky top-0 z-10">
          <button onClick={() => setView("mobile-list")}>
            <ArrowLeft />
          </button>
          <div className="font-bold">{activeMachine.make}</div>
        </header>
        <div className="p-4 space-y-6">
          {lastScannedText && (
            <div className="bg-slate-100 p-2 rounded text-[10px] font-mono text-slate-500 mb-2 truncate">
              Last Scan Raw: {lastScannedText}
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
                    <Camera size={14} />
                  )}
                  Scan
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleScanClick(e, step)}
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
                        className="w-full font-mono text-lg border-b border-slate-200 focus:border-blue-500 outline-none bg-transparent"
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
    <div className="min-h-screen bg-slate-50 p-4">
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
              <div className="font-bold text-sm">{m.make}</div>
              <div className="text-xs text-slate-500">{m.serial}</div>
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
