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
} from "lucide-react";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

// --- LOGIC FUNCTIONS (Moved inside to avoid import errors) ---

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
      // Check if the row exists and has "Inspection Number" in the first few columns
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

    // Parse data starting from the header row
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
    const out = doc.getZip().generate({
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

const parseRaySafeText = (text: string, field: string): string => {
  // RaySafe Format: "80.48 kVp", "50.34 ms", "179.3 uGy"

  let regex: RegExp;

  if (field === "kvp") {
    // Look for number followed by kV or kVp
    regex = /(\d+\.?\d*)\s*(kV|kVp)/i;
  } else if (field === "time") {
    // Look for number followed by ms, s, sec
    regex = /(\d+\.?\d*)\s*(ms|s|sec)/i;
  } else if (field === "dose") {
    // Look for number followed by mGy, uGy, R, mR, Gy
    // Note: Google Vision often reads 'µ' as 'u' or 'y' or just 'm'
    regex = /(\d+\.?\d*)\s*(mGy|uGy|µGy|Gy|R|mR)/i;
  } else if (field === "hvl") {
    regex = /(\d+\.?\d*)\s*(mm)/i;
  } else {
    // Fallback: Just grab the first big number
    regex = /(\d+\.?\d*)/;
  }

  const match = text.match(regex);
  return match ? match[1] : "";
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

  // Handlers
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

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    parseExcel(file, (data) => {
      const newMachines: Machine[] = data
        // FILTER 1: Must have basic data columns
        .filter((row: any) => row["Entity Name"] && row["Inspection Number"])
        // FILTER 2: Must be a machine row (contains parentheses with details)
        // This logic specifically targets the ALiS format "FACILITY(MAKE- MODEL - SERIAL)"
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

          // Logic to parse "TESLA MOTORS INC(THERMO- XL3T 980 - 101788)"
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
            location: row["Credential #"] || facility, // Using Credential # as identifier
            data: {},
            isComplete: false,
          };
        });

      if (newMachines.length === 0)
        alert("No valid machine rows found. Check file format.");
      else {
        setMachines(newMachines);
        alert(`Loaded ${newMachines.length} machines.`);
      }
    });
  };

  const performOCR = async (base64Image: string, field: string) => {
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
      const text = data.responses[0]?.fullTextAnnotation?.text || "";

      // Use the specialized parser for RaySafe units
      const value = parseRaySafeText(text, field);

      if (value) updateMachineData(field, value);
      else alert(`No value found in: ${text}`);
    } catch (e) {
      alert("OCR Error");
    } finally {
      setIsScanning(false);
    }
  };

  const handleCameraInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: string
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => performOCR(reader.result as string, field);
      reader.readAsDataURL(file);
    }
  };

  const updateMachineData = (field: string, value: string) => {
    if (!activeMachineId) return;
    setMachines((prev) =>
      prev.map((m) =>
        m.id === activeMachineId
          ? { ...m, data: { ...m.data, [field]: value } }
          : m
      )
    );
  };

  const generateDoc = (machine: Machine) => {
    if (!templateFile) {
      alert("Upload Template first!");
      return;
    }

    // Prepare data map for the Word template
    const data = {
      make: machine.make,
      model: machine.model,
      serial: machine.serial,
      location: machine.location,
      type: machine.type,
      kvp: machine.data["kvp"] || "---",
      time: machine.data["time"] || "---",
      dose: machine.data["dose"] || "---",
      hvl: machine.data["hvl"] || "---",
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
        <div className="border-2 border-dashed p-6 text-center rounded">
          <label className="block w-full h-full cursor-pointer">
            {templateName}
            <input
              type="file"
              accept=".docx"
              onChange={handleTemplateUpload}
              className="hidden"
            />
          </label>
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
    const fields = ["kvp", "time", "dose", "hvl"];
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <header className="bg-white p-4 border-b flex gap-3 items-center">
          <button onClick={() => setView("mobile-list")}>
            <ArrowLeft />
          </button>
          <div className="font-bold">{activeMachine.make}</div>
        </header>
        <div className="p-4 space-y-4">
          {fields.map((f) => (
            <div key={f} className="bg-white p-4 rounded border shadow-sm">
              <div className="flex justify-between mb-2">
                <span className="font-bold uppercase text-xs">{f}</span>
                <label className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold cursor-pointer flex gap-1">
                  {isScanning ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Camera size={12} />
                  )}{" "}
                  Scan
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleCameraInput(e, f)}
                    disabled={isScanning}
                  />
                </label>
              </div>
              <input
                value={activeMachine.data[f] || ""}
                onChange={(e) => updateMachineData(f, e.target.value)}
                className="w-full text-2xl font-mono border-b"
                placeholder="-"
              />
            </div>
          ))}
        </div>
        <div className="fixed bottom-0 w-full p-4 bg-white border-t">
          <button
            onClick={() => generateDoc(activeMachine)}
            className="w-full py-3 bg-emerald-600 text-white font-bold rounded shadow flex justify-center gap-2"
          >
            <Download /> Save
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
