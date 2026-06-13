import React, { useState, useRef } from "react";
import { 
  FileText, 
  UploadCloud, 
  Play, 
  Pause, 
  Download, 
  Settings2, 
  AudioWaveform, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
  Copy
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const VOICES = [
  { id: "my-MM-NilarNeural", name: "Nilar (Myanmar Female)" },
  { id: "my-MM-ThihaNeural", name: "Thiha (Myanmar Male)" },
  { id: "en-US-AriaNeural", name: "Aria (US Female)" },
  { id: "en-US-GuyNeural", name: "Guy (US Male)" },
  { id: "ja-JP-NanamiNeural", name: "Nanami (Japanese Female)" },
  { id: "ja-JP-KeitaNeural", name: "Keita (Japanese Male)" },
];

export default function App() {
  const [activeRecapTab, setActiveRecapTab] = useState<"text" | "long_srt">("text");
  const [recapOriginalSrt, setRecapOriginalSrt] = useState("");
  const [srtInput, setSrtInput] = useState("");
  const [textMode, setTextMode] = useState<"auto" | "normal">("auto");
  const [fileName, setFileName] = useState("");
  const [voice, setVoice] = useState("my-MM-NilarNeural");
  const [format, setFormat] = useState("wav");
  const [speedControl, setSpeedControl] = useState("speed_up_only");
  const [speedSettings, setSpeedSettings] = useState(1.55);
  const [pitchSettings, setPitchSettings] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [generatedSrt, setGeneratedSrt] = useState<string | null>(null);
  const [speedAdjustments, setSpeedAdjustments] = useState<string[]>([]);
  const [speedAdjustmentsWithEnd, setSpeedAdjustmentsWithEnd] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetFinalDuration, setTargetFinalDuration] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === "string") {
          setSrtInput(text);
          setError(null);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleSrtFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === "string") {
          setRecapOriginalSrt(text);
          setError(null);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    const hasText = !!srtInput.trim();
    const hasLongSrt = !!recapOriginalSrt.trim();
    
    if (!hasText && !hasLongSrt) {
      setError("Please paste Original Text or Original Long SRT, or both.");
      return;
    }

    setIsGenerating(true);
    setAudioUrl(null);
    setGeneratedSrt(null);
    setSpeedAdjustments([]);
    setSpeedAdjustmentsWithEnd([]);
    
    // Auto-Recap mode triggers when both are present
    const isAutoRecap = hasText && hasLongSrt;
    if (isAutoRecap) {
      setTargetFinalDuration(""); // Reset target duration for auto_recap before generating
    }

    try {
      if (!isAutoRecap) {
        // Normal Mode (Either Text only OR Long SRT only)
        const textToProcess = hasLongSrt ? recapOriginalSrt.trim() : srtInput.trim();
        
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            text: textToProcess, 
            voice, 
            format, 
            speedControl, 
            returnJson: true,
            speed: speedSettings,
            pitch: pitchSettings,
            textMode: hasLongSrt ? "auto" : textMode // Force auto if we are processing SRT, else use selected
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to generate audio.");
        }

        let data;
        try {
          data = await response.json();
        } catch (e) {
          throw new Error("Server took too long or returned an invalid response. Please try with a shorter text.");
        }
        
        const audioParts = data.audio.split(",");
        const mimeMatch = audioParts[0].match(/:(.*?);/);
        const mimeType = mimeMatch ? mimeMatch[1] : `audio/${format}`;
        const binaryString = atob(audioParts[1] || audioParts[0]);
        
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setGeneratedSrt(data.srt);
        if (data.speedAdjustments) setSpeedAdjustments(data.speedAdjustments);
        if (data.speedAdjustmentsWithEnd) setSpeedAdjustmentsWithEnd(data.speedAdjustmentsWithEnd);

      } else {
        // === FULLY AUTO-RECAP MODE ===
        // 1. Text to Speech
        const textRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            text: srtInput.trim(), 
            voice, 
            format, 
            speedControl, 
            returnJson: true,
            speed: speedSettings,
            pitch: pitchSettings,
            textMode: textMode
          }),
        });

        if (!textRes.ok) {
          const errData = await textRes.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to generate Text Audio.");
        }
        const textData = await textRes.json();

        // 1b. Create URL for Download
        const audioParts = textData.audio.split(",");
        const mimeMatch = audioParts[0].match(/:(.*?);/);
        const mimeType = mimeMatch ? mimeMatch[1] : `audio/${format}`;
        const binaryString = atob(audioParts[1] || audioParts[0]);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        const blob = new Blob([bytes], { type: mimeType });
        
        setAudioUrl(URL.createObjectURL(blob));
        setGeneratedSrt(textData.srt);

        // 1c. Find Timestamp
        const timecodeRegex = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/g;
        let lastTime = "00:00:00,000";
        let match;
        while ((match = timecodeRegex.exec(textData.srt)) !== null) {
          lastTime = match[2]; // Capture the ending timestamp
        }
        setTargetFinalDuration(lastTime);

        // 2. SRT to Speech (to get speed adjustments script)
        const srtRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            text: recapOriginalSrt.trim(), 
            voice, 
            format, 
            speedControl, 
            returnJson: true,
            speed: speedSettings,
            pitch: pitchSettings,
            textMode: "auto"
          }),
        });

        if (!srtRes.ok) {
          const errData = await srtRes.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to process Original SRT.");
        }
        const srtData = await srtRes.json();
        
        if (srtData.speedAdjustments) setSpeedAdjustments(srtData.speedAdjustments);
        if (srtData.speedAdjustmentsWithEnd) setSpeedAdjustmentsWithEnd(srtData.speedAdjustmentsWithEnd);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlayback = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = fileName.trim() ? `${fileName.trim()}.${format}` : `voiceover-${voice.toLowerCase()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadSrt = () => {
    if (!generatedSrt) return;
    const blob = new Blob([generatedSrt], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.trim() ? `${fileName.trim()}.srt` : `voiceover-${voice.toLowerCase()}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const generateColabScript = () => {
    const defaultName = fileName ? fileName.trim() : "video";
    const inputVideo = `${defaultName}.mp4`;
    const outputVideo = `${defaultName}_Edit.mp4`;
    const speedText = speedAdjustments.join("\n");

    return `import re
import subprocess

# ==============================================================
# ၁။ ဒီမှာ မင်း upload လုပ်ထားတဲ့ Video နာမည်ကို ရေးပါ
input_video = "${inputVideo}"       
output_video = "${outputVideo}" 

# ၂။ ဒီမှာ App ထဲက Speed Adjustments ရလဒ်တွေကို Copy ကူးထည့်ပါ
speed_text = """
${speedText}
"""
# ==============================================================

def time_to_sec(time_str):
    h, m, s_ms = time_str.split(':')
    s, ms = s_ms.split(',')
    return int(h)*3600 + int(m)*60 + int(s) + int(ms)/1000.0

def get_atempo_strings(tempo):
    filters = []
    while tempo < 0.5:
        filters.append("atempo=0.5")
        tempo /= 0.5
    while tempo > 100.0:
        filters.append("atempo=100.0")
        tempo /= 100.0
    filters.append(f"atempo={tempo:.5f}")
    return ",".join(filters)

def get_duration(filename):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                             "format=duration", "-of",
                             "default=noprint_wrappers=1:nokey=1", filename],
        stdout=subprocess.PIPE, text=True)
    return float(result.stdout.strip())

print("Reading video info...")
try:
    total_duration = get_duration(input_video)
except Exception as e:
    print(f"Error: Could not read video '{input_video}'. Did you upload it properly?")
    exit()

# Parse timestamps
pattern = r"(\\d{2}:\\d{2}:\\d{2},\\d{3})\\s*-->\\s*(\\d{2}:\\d{2}:\\d{2},\\d{3})\\s*\\[([+-]?\\d+)%\\]"
matches = re.findall(pattern, speed_text)

adjustments = []
for match in matches:
    adjustments.append({
        'start': time_to_sec(match[0]),
        'end': time_to_sec(match[1]),
        'percent': int(match[2])
    })

adjustments.sort(key=lambda x: x['start'])
segments = []
last_end = 0.0

for adj in adjustments:
    start = adj['start']
    end = adj['end']
    if start >= total_duration: continue
    if end > total_duration: end = total_duration

    if start > last_end + 0.05:
        segments.append({'start': last_end, 'end': start, 'v_pts': 1.0, 'a_tempo': 1.0})

    # Voice speed ကို ပြောင်းပြန်လှန်ပြီး normal ပြန်လုပ်ခြင်း (Reverse engineering timing)
    original_tempo = 1.0 + (adj['percent'] / 100.0)
    if original_tempo < 0.1: original_tempo = 0.1
    
    v_pts = original_tempo
    a_tempo = 1.0 / original_tempo

    segments.append({'start': start, 'end': end, 'v_pts': v_pts, 'a_tempo': a_tempo})
    last_end = end

if total_duration > last_end + 0.05:
    segments.append({'start': last_end, 'end': total_duration, 'v_pts': 1.0, 'a_tempo': 1.0})

filter_script = ""
concat_inputs = ""

for i, seg in enumerate(segments):
    start = seg['start']
    end = seg['end']
    v_pts = seg['v_pts']
    a_tempo = seg['a_tempo']
    
    a_filter = get_atempo_strings(a_tempo)
    
    filter_script += f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS,setpts={v_pts}*PTS[v{i}];\\n"
    filter_script += f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS,{a_filter}[a{i}];\\n"
    concat_inputs += f"[v{i}][a{i}]"

filter_script += f"{concat_inputs}concat=n={len(segments)}:v=1:a=1[outv][outa]"

with open("filter.txt", "w") as f:
    f.write(filter_script)

print("Processing video... This will take a while.")
cmd = [
    "ffmpeg", "-y", "-i", input_video,
    "-filter_complex_script", "filter.txt",
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "192k",
    output_video
]

subprocess.run(cmd)
print(f"✅ Success! Video processing complete. Download '{output_video}' from the folder menu.")`;
  };


  const generateColabScriptRemoveAllGapsFlipAntiCopyrightEnd = () => {
    const defaultName = fileName ? fileName.trim() : "video";
    const inputVideo = `${defaultName}.mp4`;
    const outputVideo = `${defaultName}_Edit.mp4`;
    const speedText = speedAdjustmentsWithEnd.length > 0 ? speedAdjustmentsWithEnd.join("\n") : speedAdjustments.join("\n");

    return `import re
import subprocess
import random
import os

# ==============================================================
# ၁။ ဒီမှာ မင်း upload လုပ်ထားတဲ့ Video နာမည်ကို ရေးပါ
input_video = "${inputVideo}"       
output_video = "${outputVideo}" 

# ၂။ ဒီမှာ App ထဲက Speed Adjustments ရလဒ်တွေကို Copy ကူးထည့်ပါ
speed_text = """
${speedText}
"""

# ၃။ တကယ်လို့ Final Duration လိုချင်ရင် ဒီမှာ ထည့်ပါ။ မလိုရင် အလွတ်ထားပါ။ 
# format: HH:MM:SS,ms သို့မဟုတ် seconds (ဥပမာ - "00:00:24,320")
target_final_duration_str = "${targetFinalDuration.trim()}"
# ==============================================================

def time_to_sec(time_str):
    if ':' in time_str:
        h, m, s_ms = time_str.split(':')
        if ',' in s_ms:
            s, ms = s_ms.split(',')
            return int(h)*3600 + int(m)*60 + int(s) + int(ms)/1000.0
        else:
            s, ms = s_ms.split('.') if '.' in s_ms else (s_ms, "0")
            return int(h)*3600 + int(m)*60 + int(s) + float("0." + ms)
    return float(time_str.replace(',','.'))

def get_atempo_strings(tempo):
    filters = []
    while tempo < 0.5:
        filters.append("atempo=0.5")
        tempo /= 0.5
    while tempo > 100.0:
        filters.append("atempo=100.0")
        tempo /= 100.0
    filters.append(f"atempo={tempo:.5f}")
    return ",".join(filters)

def get_duration(filename):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                             "format=duration", "-of",
                             "default=noprint_wrappers=1:nokey=1", filename],
        stdout=subprocess.PIPE, text=True)
    return float(result.stdout.strip())

print("Reading video info...")
try:
    total_duration = get_duration(input_video)
except Exception as e:
    print(f"Error: Could not read video '{input_video}'. Did you upload it properly?")
    exit()

# Parse timestamps
pattern = r"(\\d{2}:\\d{2}:\\d{2},\\d{3})\\s*-->\\s*(\\d{2}:\\d{2}:\\d{2},\\d{3})\\s*\\[([+-]?\\d+)%\\]"
matches = re.findall(pattern, speed_text)

adjustments = []
for match in matches:
    adjustments.append({
        'start': time_to_sec(match[0]),
        'end': time_to_sec(match[1]),
        'percent': int(match[2])
    })

adjustments.sort(key=lambda x: x['start'])
segments = []
total_out_duration = 0.0

for adj in adjustments:
    start = adj['start']
    end = adj['end']
    if start >= total_duration: continue
    if end > total_duration: end = total_duration

    original_tempo = 1.0 + (adj['percent'] / 100.0)
    if original_tempo < 0.1: original_tempo = 0.1
    
    v_pts = original_tempo
    a_tempo = 1.0 / original_tempo

    segments.append({'start': start, 'end': end, 'v_pts': v_pts, 'a_tempo': a_tempo})
    total_out_duration += (end - start) * v_pts

if len(segments) == 0:
    segments.append({'start': 0.0, 'end': total_duration, 'v_pts': 1.0, 'a_tempo': 1.0})
    total_out_duration = total_duration

global_v_pts = 1.0
global_a_tempo = 1.0

target_duration_str = target_final_duration_str.strip()
if target_duration_str:
    try:
        t_dur = time_to_sec(target_duration_str)
        if total_out_duration > 0 and t_dur > 0:
            global_v_pts = t_dur / total_out_duration
            global_a_tempo = total_out_duration / t_dur
            print(f"Applying final global stretch: target={t_dur:.3f}s / current={total_out_duration:.3f}s (Speed multiplier: {global_a_tempo:.4f}x)")
    except Exception as e:
        print("Warning: Could not parse target_final_duration_str. Ignoring global stretch.")

filter_script = ""
concat_inputs = ""

current_flip_state = False
time_since_last_flip = 0.0
next_flip_threshold = random.uniform(7.0, 12.0)

for i, seg in enumerate(segments):
    start = seg['start']
    end = seg['end']
    
    v_pts = seg['v_pts'] * global_v_pts
    a_tempo = seg['a_tempo'] * global_a_tempo
    
    a_filter = get_atempo_strings(a_tempo)
    
    seg_duration = (end - start) * v_pts
    
    if current_flip_state:
        filter_script += f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS,hflip,setpts={v_pts}*PTS[v{i}];\\n"
    else:
        filter_script += f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS,setpts={v_pts}*PTS[v{i}];\\n"
        
    filter_script += f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS,{a_filter}[a{i}];\\n"
    concat_inputs += f"[v{i}][a{i}]"
    
    time_since_last_flip += seg_duration
    if time_since_last_flip >= next_flip_threshold:
        current_flip_state = not current_flip_state
        time_since_last_flip = 0.0
        next_flip_threshold = random.uniform(7.0, 12.0)

filter_script += f"{concat_inputs}concat=n={len(segments)}:v=1:a=1[conc_v][outa];\\n"

# Anti-Copyright Zoom & Color filter string
filter_script += "[conc_v]scale=w='trunc(iw*1.04/2)*2':h='trunc(ih*1.04/2)*2',crop=w='trunc(iw/1.04/2)*2':h='trunc(ih/1.04/2)*2',eq=brightness=0.03:contrast=1.03:saturation=1.05[outv]"

with open("filter.txt", "w") as f:
    f.write(filter_script)

print("Processing video... This will take a while.")
cmd = [
    "ffmpeg", "-y", "-i", input_video,
    "-filter_complex_script", "filter.txt",
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "192k",
    output_video
]

subprocess.run(cmd)
print(f"✅ Success! Video processing complete. Download '{output_video}' from the folder menu.")`;
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-12">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center">
              <AudioWaveform className="text-white w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-800">
              H <span className="text-indigo-600">Clone</span>
            </span>
          </div>
          <div className="flex items-center space-x-4 text-sm font-medium">
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 mt-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* Left Column: Input */}
          <div className="md:col-span-8 space-y-6">

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <label className="text-base font-semibold text-slate-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-500" />
                  Name
                </label>
              </div>
              <input
                type="text"
                placeholder="e.g. John"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 min-h-[50px] rounded-xl p-4 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none transition font-mono text-sm leading-relaxed"
              />
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex gap-6 border-b border-slate-200 mb-4">
                <button
                  onClick={() => setActiveRecapTab("text")}
                  className={`pb-3 text-sm font-semibold transition-colors relative ${activeRecapTab === "text" ? "text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Original Text
                  </div>
                  {activeRecapTab === "text" && (
                    <motion.div layoutId="recapTabIndicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
                  )}
                </button>
                <button
                  onClick={() => setActiveRecapTab("long_srt")}
                  className={`pb-3 text-sm font-semibold transition-colors relative ${activeRecapTab === "long_srt" ? "text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Original Long SRT
                  </div>
                  {activeRecapTab === "long_srt" && (
                    <motion.div layoutId="recapTabIndicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
                  )}
                </button>
              </div>

              <textarea
                value={activeRecapTab === "text" ? srtInput : recapOriginalSrt}
                onChange={(e) => activeRecapTab === "text" ? setSrtInput(e.target.value) : setRecapOriginalSrt(e.target.value)}
                placeholder={activeRecapTab === "text" ? "Paste your Original Text here..." : "Paste your original long SRT here..."}
                className="w-full h-40 p-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition resize-none text-slate-700 font-mono text-sm leading-relaxed"
                spellCheck="false"
              />

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {activeRecapTab === "text" && (
                    <>
                      <label className="text-sm font-medium text-slate-700 flex items-center gap-2 cursor-pointer">
                        <input 
                          type="radio" 
                          name="textMode" 
                          value="auto" 
                          checked={textMode === "auto"} 
                          onChange={() => setTextMode("auto")}
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        Auto
                      </label>
                      <label className="text-sm font-medium text-slate-700 flex items-center gap-2 cursor-pointer">
                        <input 
                          type="radio" 
                          name="textMode" 
                          value="normal" 
                          checked={textMode === "normal"} 
                          onChange={() => setTextMode("normal")}
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        Normal
                      </label>
                    </>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  <span>{(activeRecapTab === "text" ? srtInput : recapOriginalSrt).length} chars</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Controls & Output */}
          <div className="md:col-span-4 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  className="text-base font-semibold text-slate-800 flex items-center gap-2 hover:opacity-80 transition"
                >
                  <SlidersHorizontal className="w-5 h-5 text-indigo-600" />
                  Voice Settings
                </button>
                {isSettingsOpen && (
                  <button
                    onClick={() => { setSpeedSettings(1.55); setPitchSettings(0); }}
                    className="text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-md hover:bg-indigo-100 transition"
                  >
                    Default Speed/Pitch
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <AnimatePresence>
                  {isSettingsOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-5 mb-4">
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-medium text-slate-700">Speed</label>
                            <span className="text-xs font-medium text-slate-500">{speedSettings.toFixed(2)}x</span>
                          </div>
                          <input
                            type="range"
                            min="0.25"
                            max="4"
                            step="0.05"
                            value={speedSettings}
                            onChange={(e) => setSpeedSettings(parseFloat(e.target.value))}
                            className="w-full accent-indigo-600"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-medium text-slate-700">Pitch</label>
                            <span className="text-xs font-medium text-slate-500">{pitchSettings}</span>
                          </div>
                          <input
                            type="range"
                            min="-100"
                            max="100"
                            step="1"
                            value={pitchSettings}
                            onChange={(e) => setPitchSettings(parseInt(e.target.value))}
                            className="w-full accent-indigo-600"
                          />
                          <p className="text-[11px] text-slate-400 mt-2 leading-tight">
                            Note: Applied as the baseline for both text and SRT generation.
                          </p>
                        </div>

                        <div className="mb-4">
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Output Format
                          </label>
                          <select
                            value={format}
                            onChange={(e) => setFormat(e.target.value)}
                            className="w-full pl-3 pr-10 py-2.5 text-sm border-slate-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-lg border bg-white hover:bg-slate-50 transition cursor-pointer appearance-none"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right .5rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.5em 1.5em` }}
                          >
                            <option value="wav">WAV (High Quality)</option>
                            <option value="mp3">MP3 (Smaller Size)</option>
                          </select>
                        </div>

                        {(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(srtInput) || /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(recapOriginalSrt)) && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                              Speed Adjustment
                            </label>
                            <select
                              value={speedControl}
                              onChange={(e) => setSpeedControl(e.target.value)}
                              className="w-full pl-3 pr-10 py-2.5 text-sm border-slate-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-lg border bg-white hover:bg-slate-50 transition cursor-pointer appearance-none"
                              style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right .5rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.5em 1.5em` }}
                            >
                              <option value="speed_up_only">Speed Up Only (Natural)</option>
                              <option value="speed_up_and_down">Speed Up & Slow Down (Strict Fit)</option>
                            </select>
                          </div>
                        )}

                        <button
                          onClick={() => setIsSettingsOpen(false)}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition mt-4 shadow-sm"
                        >
                          Confirm
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    AI Voice
                  </label>
                  <select
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    className="w-full pl-3 pr-10 py-2.5 text-base border-slate-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-lg border bg-slate-50 hover:bg-slate-100/50 transition cursor-pointer appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right .5rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.5em 1.5em` }}
                  >
                    {VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || (!srtInput.trim() && !recapOriginalSrt.trim())}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white py-3 px-4 rounded-xl font-medium transition shadow-sm hover:shadow active:scale-[0.98]"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating Audio...
                    </>
                  ) : (
                    <>
                      Convert to Speech
                    </>
                  )}
                </button>
              </div>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-100 flex gap-2 items-start text-sm text-red-600">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}
            </div>

            <AnimatePresence>
              {audioUrl && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-indigo-50 rounded-2xl border border-indigo-100 p-6 shadow-sm flex flex-col items-center"
                >
                  <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h4 className="text-indigo-900 font-semibold mb-6">Generation Complete!</h4>

                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onEnded={() => setIsPlaying(false)}
                    className="hidden"
                  />

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
                    <button
                      onClick={togglePlayback}
                      className="flex-1 flex w-full sm:w-auto items-center justify-center gap-2 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 py-2.5 px-4 rounded-lg font-medium transition shadow-sm"
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex-1 flex w-full sm:w-auto items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 px-4 rounded-lg font-medium transition shadow-sm"
                    >
                      <Download className="w-4 h-4" />
                      {format.toUpperCase()}
                    </button>
                    {generatedSrt && (
                      <button
                        onClick={handleDownloadSrt}
                        className="flex-1 flex w-full sm:w-auto items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white py-2.5 px-4 rounded-lg font-medium transition shadow-sm"
                      >
                        <Download className="w-4 h-4" />
                        SRT
                      </button>
                    )}
                  </div>
                  
                  {speedAdjustments && speedAdjustments.length > 0 && (
                    <div className="mt-6 w-full text-left space-y-6">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-semibold text-slate-800">
                            Keep Inner Gaps
                          </label>
                          <button
                            onClick={() => navigator.clipboard.writeText(generateColabScript())}
                            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md transition"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                          </button>
                        </div>
                        <textarea
                          readOnly
                          value={generateColabScript()}
                          className="w-full bg-white border border-slate-200 rounded-lg p-3 h-40 text-xs font-mono text-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-semibold text-slate-800">
                            Remove All Gaps (Flip & Anti-Copyright & End)
                          </label>
                          <button
                            onClick={() => navigator.clipboard.writeText(generateColabScriptRemoveAllGapsFlipAntiCopyrightEnd())}
                            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md transition"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                          </button>
                        </div>
                        <div className="mb-3">
                          <input
                            type="text"
                            placeholder="Target Final Duration (e.g. 00:00:24,320 or 24.32) - Optional"
                            value={targetFinalDuration}
                            onChange={(e) => setTargetFinalDuration(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                          />
                        </div>
                        <textarea
                          readOnly
                          value={generateColabScriptRemoveAllGapsFlipAntiCopyrightEnd()}
                          className="w-full bg-white border border-slate-200 rounded-lg p-3 h-40 text-xs font-mono text-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
