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
  Edit3,
} from "lucide-react";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

// --- CONFIGURATION ---
const WORKSPACE_NAME = "rlis";
const WORKFLOW_ID = "find-kvps-mrs-times-and-hvls";
const ROBOFLOW_WORKFLOW_URL = `https://serverless.roboflow.com/infer/workflows/${WORKSPACE_NAME}/${WORKFLOW_ID}`;
const ROBOFLOW_API_KEY = "M9vlXyIc0R1gBNSWuKdh";

// --- ZONES CONFIGURATION (The RaySafe Screen Layout) ---
// We map the screen coordinates to specific fields.
// Coordinates derived from your JSON data.
const SCREEN_ZONES = [
  // Row 1
  { id: "kvp", minX: 0, maxX: 220, minY: 0, maxY: 130 },
  { id: "mR", minX: 220, maxX: 350, minY: 0, maxY: 130 }, // Dose
  { id: "time", minX: 350, maxX: 600, minY: 0, maxY: 130 },
  // Row 2
  { id: "hvl", minX: 0, maxX: 220, minY: 130, maxY: 250 },
];

// --- HELPER FUNCTIONS (OUTSIDE COMPONENT) ---

// 1. ARRAY FINDER: Finds the LIST containing the data we need
const findArrayWithKey = (obj: any, keyToFind: string): any[] | null => {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    // Check if the first item has the key we want
    if (obj.length > 0 && typeof obj[0] === "object" && keyToFind in obj[0]) {
      return obj;
    }
    // Deep search inside items
    for (const item of obj) {
      const found = findArrayWithKey(item, keyToFind);
      if (found) return found;
    }
    return null;
  }
  for (const k of Object.keys(obj)) {
    const found = findArrayWithKey(obj[k], keyToFind);
    if (found) return found;
  }
  return null;
};

// 2. ZONE MATCHER: Checks which Zone a point falls into
const getZoneForPoint = (x: number, y: number) => {
  return SCREEN_ZONES.find(
    (z) => x >= z.minX && x <= z.maxX && y >= z.minY && y <= z.maxY
  );
};

// 3. EXCEL PARSER
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
      alert("Could not find header row 'Inspection Number'.");
      return;
    }
    const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });
    callback(data);
  };
  reader.readAsArrayBuffer(file);
};

// 4. DOC GENERATOR
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

// --- TYPES ---
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
    indices: ["kvp", "mR", "time", "hvl"],
    fields: ["kvp", "mR1", "time1", "hvl"],
  },
  {
    id: "scan2",
    label: "2. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR2", "time2"],
    indices: ["mR", "time"],
  },
  {
    id: "scan3",
    label: "3. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR3", "time3"],
    indices: ["mR", "time"],
  },
  {
    id: "scan4",
    label: "4. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR4", "time4"],
    indices: ["mR", "time"],
  },
  {
    id: "scan5",
    label: "5. Scatter (6ft)",
    desc: "Order: Dose (2nd)",
    fields: ["6 foot"],
    indices: ["mR"],
  },
  {
    id: "scan6",
    label: "6. Scatter (Operator)",
    desc: "Order: Dose (2nd)",
    fields: ["operator location"],
    indices: ["mR"],
  },
];

export default function RayScanLocal() {
  const [view, setView] = useState<
    "dashboard" | "mobile-list" | "mobile-form" | "settings"
  >("dashboard");
  const [apiKey, setApiKey] = useState(ROBOFLOW_API_KEY);
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
    const savedMachines = localStorage.getItem("rayScanMachines");
    if (savedMachines) setMachines(JSON.parse(savedMachines));
  }, []);

  useEffect(() => {
    localStorage.setItem("rayScanMachines", JSON.stringify(machines));
  }, [machines]);

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

  // --- NEW ZONE-BASED ROBOFLOW LOGIC ---
  const performRoboflowScan = async (
    base64Image: string,
    targetFields: string[],
    zoneIds: string[]
  ) => {
    if (!apiKey) {
      alert("Set Roboflow API Key first!");
      return;
    }
    setIsScanning(true);

    try {
      const imageContent = base64Image.split(",")[1];
      const endpoint = `${ROBOFLOW_WORKFLOW_URL}?api_key=${apiKey}`;

      console.log("🚀 Sending image to:", endpoint);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: {
            image: { type: "base64", value: imageContent },
          },
          api_key: apiKey,
        }),
      });

      const result = await response.json();
      console.log("🔴 ROBOFLOW RESPONSE:", result);

      if (result.detail) throw new Error(`API Error: ${result.detail}`);
      if (result.message) throw new Error(result.message);

      // 1. FIND DATA (Fallback logic for text source)
      let rawOcr = findArrayWithKey(result, "text");
      const rawPreds = findArrayWithKey(result, "class"); // Predictions often contain the text

      // Fallback: If no dedicated text array, use the predictions array
      if (!rawOcr && rawPreds) {
        console.log("Using predictions as OCR source");
        rawOcr = rawPreds;
      }

      if (!rawOcr) {
        throw new Error(
          "Scan successful, but no text blocks found in response."
        );
      }

      // 2. PROCESS TEXT & MAP TO ZONES
      const foundValues: Record<string, number> = {};
      const debugFound: string[] = [];

      rawOcr.forEach((item: any) => {
        let x = item.x,
          y = item.y,
          text = item.text || item.class || "";
        let offsetX = 0,
          offsetY = 0;

        // Handle Nested Predictions (Google Vision style)
        const inner = item.predictions?.predictions?.[0];
        if (inner) {
          if (inner.x) {
            x = inner.x;
            y = inner.y;
          }
          // Offset Logic
          if (inner.parent_origin) {
            offsetX = inner.parent_origin.offset_x || 0;
            offsetY = inner.parent_origin.offset_y || 0;
          } else if (item.predictions?.parent_origin) {
            offsetX = item.predictions.parent_origin.offset_x || 0;
            offsetY = item.predictions.parent_origin.offset_y || 0;
          }
          if (!text) text = inner.class || "";
        } else {
          // Standard Format Offsets
          if (item.parent_origin) {
            offsetX = item.parent_origin.offset_x || 0;
            offsetY = item.parent_origin.offset_y || 0;
          }
        }

        // Apply Offset
        const globalX = (x || 0) + offsetX;
        const globalY = (y || 0) + offsetY;

        // Extract Number
        const numberMatch = text.match(/(\d+\.?\d*)/);
        if (numberMatch) {
          const val = parseFloat(numberMatch[0]);

          // CHECK ZONES
          const zone = getZoneForPoint(globalX, globalY);
          if (zone) {
            foundValues[zone.id] = val;
            debugFound.push(`${zone.id}: ${val}`);
          }
        }
      });

      setLastScannedText(debugFound.join(", ") || "No matching zones");

      // 3. UPDATE STATE
      const updates: Record<string, string> = {};

      targetFields.forEach((field, i) => {
        const requiredZoneId = zoneIds[i]; // e.g. "kvp"
        const val = foundValues[requiredZoneId];

        if (val !== undefined) {
          updates[field] = val.toString();
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
          "Scan complete. Text found, but coordinates didn't match any zones."
        );
      }
    } catch (e: any) {
      console.error(e);
      alert("Scan Error: " + e.message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanClick = (
    e: React.ChangeEvent<HTMLInputElement>,
    fields: string[],
    zoneIds: string[]
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        performRoboflowScan(reader.result as string, fields, zoneIds);
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
    if (window.confirm("Delete all machines?")) {
      setMachines([]);
      localStorage.removeItem("rayScanMachines");
    }
  };

  const activeMachine = machines.find((m) => m.id === activeMachineId);

  // --- UI ---
  if (view === "settings")
    return (
      <div className="min-h-screen bg-slate-50 p-6 font-sans">
        <button
          onClick={() => setView("dashboard")}
          className="mb-6 flex gap-2 font-bold text-slate-600 active:scale-95 transition-transform"
        >
          <ArrowLeft /> Back
        </button>
        <h1 className="text-2xl font-bold mb-4 text-slate-800">Settings</h1>
        <div className="space-y-4">
          <div className="bg-green-50 p-4 rounded-lg border border-green-200 text-green-800 text-sm">
            <strong>API Key Loaded:</strong> Roboflow key is hardcoded.
          </div>
          <div className="border-2 border-dashed p-8 text-center rounded-xl relative bg-white hover:bg-slate-50 transition-colors active:scale-95 cursor-pointer">
            <label className="block w-full h-full cursor-pointer flex flex-col items-center justify-center gap-3">
              {templateFile ? (
                <>
                  <div className="h-12 w-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                    <CheckCircle size={24} />
                  </div>
                  <div>
                    <p className="text-emerald-800 font-bold text-lg">
                      {templateName}
                    </p>
                    <p className="text-emerald-600 text-sm">Template Loaded</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                    <FileSpreadsheet size={24} />
                  </div>
                  <div>
                    <p className="text-slate-600 font-bold">
                      Tap to Upload Template
                    </p>
                    <p className="text-slate-400 text-sm">
                      Supports .docx files only
                    </p>
                  </div>
                </>
              )}
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
                className="absolute top-2 right-2 p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 active:scale-90 transition-all shadow-sm"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    );

  if (view === "mobile-list")
    return (
      <div className="min-h-screen bg-slate-100 pb-20 font-sans">
        <header className="bg-blue-900 text-white p-4 flex justify-between items-center shadow-md sticky top-0 z-20">
          <button
            onClick={() => setView("dashboard")}
            className="p-1 hover:bg-blue-800 rounded-lg transition-colors active:scale-95 flex items-center gap-1 text-sm font-bold"
          >
            <ArrowLeft size={20} /> Back
          </button>
          <h1 className="font-bold text-lg">My Inspections</h1>
          <div className="w-10"></div>
        </header>
        <div className="p-4 space-y-3">
          {machines.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setActiveMachineId(m.id);
                setView("mobile-form");
              }}
              className="bg-white p-4 rounded-xl shadow-sm flex justify-between items-center cursor-pointer active:scale-95 transition-transform border border-slate-100 hover:border-blue-200"
            >
              <div>
                <div className="font-bold text-lg text-blue-900">
                  {m.location}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {m.fullDetails}
                </div>
              </div>
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center ${
                  m.isComplete
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {m.isComplete ? (
                  <CheckCircle size={18} />
                ) : (
                  <ChevronRight size={18} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );

  if (view === "mobile-form" && activeMachine)
    return (
      <div className="min-h-screen bg-slate-50 pb-24 font-sans">
        <header className="bg-white p-4 border-b sticky top-0 z-20 shadow-sm">
          <div className="flex gap-3 items-center mb-1">
            <button
              onClick={() => setView("mobile-list")}
              className="p-2 hover:bg-slate-100 rounded-full active:scale-90 transition-transform"
            >
              <ArrowLeft className="text-slate-600" />
            </button>
            <div className="font-bold text-lg text-slate-800">
              {activeMachine.location}
            </div>
          </div>
          <div className="text-xs text-slate-500 ml-11">
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
                  className="w-full p-2.5 border rounded text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
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
                  className="w-full p-2.5 border rounded text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
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
                  className="w-full p-2.5 border rounded text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
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
                  className="w-full p-2.5 border rounded text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="0.10"
                  value={activeMachine.data["preset_time"] || ""}
                  onChange={(e) => updateField("preset_time", e.target.value)}
                />
              </div>
            </div>
          </div>
          {lastScannedText && (
            <div className="bg-slate-100 p-3 rounded-lg border border-slate-200 text-[10px] font-mono text-slate-500 mb-2 overflow-hidden">
              <div className="font-bold mb-1 text-slate-700">Found Zones:</div>
              <div className="mt-1 truncate opacity-50">{lastScannedText}</div>
            </div>
          )}
          {DENTAL_STEPS.map((step) => (
            <div
              key={step.id}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="font-bold text-sm text-blue-900">
                    {step.label}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {step.desc}
                  </div>
                </div>
                <label
                  className={`px-4 py-2.5 rounded-lg text-xs font-bold cursor-pointer flex gap-2 items-center shadow-sm active:scale-95 transition-all ${
                    isScanning
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {isScanning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Camera size={14} />
                  )}{" "}
                  {isScanning ? " scanning..." : "Scan"}
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
              <div className="grid grid-cols-2 gap-4">
                {step.fields.map((k) => (
                  <div key={k}>
                    <label className="text-[9px] font-bold text-slate-400 uppercase mb-1 block">
                      {k}
                    </label>
                    <div className="relative">
                      <input
                        value={activeMachine.data[k] || ""}
                        onChange={(e) => updateField(k, e.target.value)}
                        className="w-full font-mono text-lg border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-transparent transition-colors py-1"
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
        <div className="fixed bottom-0 w-full p-4 bg-white border-t shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <button
            onClick={() => generateDoc(activeMachine)}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg flex justify-center gap-2 active:scale-95 transition-transform"
          >
            <Download className="h-5 w-5" /> Save Report
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans">
      <header className="flex justify-between items-center mb-8">
        <div className="flex gap-2 items-center">
          <div className="bg-blue-600 p-2 rounded-lg">
            <ScanLine className="text-white h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">RayScan</h1>
        </div>
        <button
          onClick={() => setView("settings")}
          className="p-2 bg-white border border-slate-200 rounded-full hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
        >
          <Settings className="text-slate-600 h-5 w-5" />
        </button>
      </header>
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 mb-6 text-center">
        <div className="text-5xl font-bold text-blue-600 mb-2 tracking-tight">
          {machines.length}
        </div>
        <div className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-6">
          Machines Loaded
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="bg-slate-50 text-slate-600 py-4 rounded-xl font-bold text-sm cursor-pointer hover:bg-slate-100 border border-slate-200 transition-all active:scale-95">
            <div className="flex justify-center mb-2">
              <FileSpreadsheet size={20} className="text-emerald-600" />
            </div>
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
            disabled={machines.length === 0}
            className="bg-blue-600 text-white py-4 rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-lg shadow-blue-200"
          >
            <div className="flex justify-center mb-2">
              <Camera size={20} />
            </div>
            Start Scan
          </button>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Machine List
          </span>
          {machines.length > 0 && (
            <button
              onClick={clearAll}
              className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
        {machines.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            No machines loaded.
            <br />
            Import an ALiS Excel file to begin.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {machines.map((m) => (
              <div
                key={m.id}
                className="p-4 border-b border-slate-50 flex justify-between items-center last:border-0 hover:bg-slate-50 transition-colors"
              >
                <div>
                  <div className="font-bold text-sm text-slate-800">
                    {m.location}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {m.fullDetails}
                  </div>
                </div>
                {m.isComplete ? (
                  <div className="bg-emerald-100 p-1.5 rounded-full">
                    <CheckCircle className="text-emerald-600 h-4 w-4" />
                  </div>
                ) : (
                  <div className="bg-slate-100 p-1.5 rounded-full">
                    <ChevronRight className="text-slate-400 h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
