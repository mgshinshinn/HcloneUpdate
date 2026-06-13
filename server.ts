import express from "express";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { Readable, Writable } from "stream";
import os from "node:os";
import fs from "node:fs";
import { EdgeTTS } from "node-edge-tts";

import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}
if (ffprobeStatic && ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

function createWavHeader(
  dataLength: number,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(dataLength + 36, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function splitIntoChunks(text: string, maxLength: number = 800): string[] {
  const sentences = text.match(/[^၊။.!?\n]+[၊။.!?\n]*/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks.length > 0 ? chunks : [text];
}

function splitTextForSrt(text: string): string[] {
  const parts = text.split(/[\n၊။.!?]+/);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function splitTextForSubtitles(text: string, maxLen: number = 25): string[] {
  const finalLines: string[] = [];
  const paragraphs = text.split('\n');
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('my', { granularity: 'word' }) : null;

  for (const p of paragraphs) {
    if (!p.trim()) continue;
    const words = p.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!word) continue;

      let candidate = currentLine ? currentLine + " " + word : word;
      if (candidate.length <= maxLen) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          finalLines.push(currentLine.trim());
        }

        if (word.length > maxLen && segmenter) {
          const segments = Array.from(segmenter.segment(word)).map(s => s.segment);
          currentLine = "";
          for (const seg of segments) {
            if (!currentLine) {
              currentLine = seg;
            } else if ((currentLine + seg).length <= maxLen) {
              currentLine += seg;
            } else {
              finalLines.push(currentLine.trim());
              currentLine = seg;
            }
          }
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) {
      finalLines.push(currentLine.trim());
    }
  }

  const absoluteLines: string[] = [];
  for (const line of finalLines) {
    if (line.length > maxLen) {
      for (let i = 0; i < line.length; i += maxLen) {
        absoluteLines.push(line.slice(i, i + maxLen));
      }
    } else {
      absoluteLines.push(line);
    }
  }
  
  return absoluteLines;
}

function getTempoFilter(tempo: number): string {
  if (tempo === 1.0) return "anull";
  const filters: string[] = [];
  let currentTempo = tempo;

  while (currentTempo < 0.5) {
    filters.push("atempo=0.5");
    currentTempo /= 0.5;
  }
  while (currentTempo > 100.0) {
    filters.push("atempo=100.0");
    currentTempo /= 100.0;
  }

  if (Math.abs(currentTempo - 1.0) > 0.001) {
    filters.push(`atempo=${currentTempo.toFixed(4)}`);
  }

  return filters.length > 0 ? filters.join(",") : "anull";
}

async function stretchAudioBuffer(
  pcmBuffer: Buffer,
  tempo: number
): Promise<Buffer> {
  if (Math.abs(tempo - 1.0) < 0.01) return pcmBuffer;

  const tempoStr = getTempoFilter(tempo);

  return new Promise((resolve, reject) => {
    const inputStream = new Readable();
    inputStream.push(pcmBuffer);
    inputStream.push(null);

    const bufs: Buffer[] = [];
    const outputStream = new Writable({
      write(chunk, encoding, callback) {
        bufs.push(chunk);
        callback();
      },
    });

    ffmpeg(inputStream)
      .inputFormat("s16le")
      .inputOptions(["-ar 24000", "-ac 1"])
      .audioFilter(tempoStr)
      .format("s16le")
      .audioFrequency(24000)
      .audioChannels(1)
      .on("error", (err) => reject(err))
      .on("end", () => resolve(Buffer.concat(bufs)))
      .pipe(outputStream, { end: false });
  });
}

async function generateEdgeTtsPcm(text: string, voiceName: string, speedNum: number = 1, pitchNum: number = 0): Promise<Buffer> {
  const tmpMp3 = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  
  const ratePercentage = Math.round((speedNum - 1) * 100);
  const rateStr = (ratePercentage >= 0 ? "+" : "") + ratePercentage + "%";
  const pitchStr = (pitchNum >= 0 ? "+" : "") + pitchNum + "Hz";

  let success = false;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts && !success) {
    attempts++;
    try {
      const tts = new EdgeTTS({
        voice: voiceName,
        rate: rateStr,
        pitch: pitchStr,
        timeout: 60000
      });
      await tts.ttsPromise(text, tmpMp3);
      success = true;
    } catch (err) {
      if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
      console.error(`EdgeTTS promise error (attempt ${attempts}):`, err);
      if (attempts >= maxAttempts) {
        return Buffer.alloc(0);
      }
      // Wait for a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }

  if (!fs.existsSync(tmpMp3)) {
    return Buffer.alloc(0);
  }
  
  const stat = fs.statSync(tmpMp3);
  if (stat.size === 0) {
    fs.unlinkSync(tmpMp3);
    return Buffer.alloc(0);
  }

  return new Promise((resolve, reject) => {
    const bufs: Buffer[] = [];
    const outputStream = new Writable({
      write(chunk, encoding, callback) {
        bufs.push(chunk);
        callback();
      },
    });

    ffmpeg(tmpMp3)
      .format("s16le")
      .audioFrequency(24000)
      .audioChannels(1)
      .on("error", (err) => {
        fs.unlink(tmpMp3, () => {});
        reject(err);
      })
      .on("end", () => {
        fs.unlink(tmpMp3, () => {});
        resolve(Buffer.concat(bufs));
      })
      .pipe(outputStream, { end: false });
  });
}

async function convertWavToMp3(wavBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inputStream = new Readable();
    inputStream.push(wavBuffer);
    inputStream.push(null);

    const bufs: Buffer[] = [];
    const outputStream = new Writable({
      write(chunk, encoding, callback) {
        bufs.push(chunk);
        callback();
      },
    });

    ffmpeg(inputStream)
      .inputFormat("wav")
      .format("mp3")
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .on("error", (err) => reject(err))
      .on("end", () => resolve(Buffer.concat(bufs)))
      .pipe(outputStream, { end: false });
  });
}

async function getPcmForChunk(text: string, voiceName: string, speedNum: number = 1, pitchNum: number = 0): Promise<Buffer> {
  return generateEdgeTtsPcm(text, voiceName, speedNum, pitchNum);
}

function timeStrToSeconds(timeStr: string): number {
  const [hours, minutes, rest] = timeStr.split(':');
  const [seconds, ms] = rest.split(',');
  return (
    parseInt(hours) * 3600 +
    parseInt(minutes) * 60 +
    parseInt(seconds) +
    parseInt(ms) / 1000
  );
}

function parseSrtRobust(text: string): { startSeconds: number; endSeconds: number; text: string }[] {
  const blocks = [];
  const timecodeRegex = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/g;
  let matches = [];
  let match;
  while ((match = timecodeRegex.exec(text)) !== null) {
    matches.push({
      startSeconds: timeStrToSeconds(match[1]),
      endSeconds: timeStrToSeconds(match[2]),
      index: match.index,
      length: match[0].length
    });
  }
  
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i+1];
    
    const textStart = current.index + current.length;
    const textEnd = next ? next.index : text.length;
    let content = text.substring(textStart, textEnd).trim();
    
    content = content.replace(/\n\s*\d+\s*$/, '').trim();
    
    // WebVTT or other tags sometimes sneak in, minimal cleanup
    blocks.push({
      startSeconds: current.startSeconds,
      endSeconds: current.endSeconds,
      text: content
    });
  }
  
  return blocks;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice, format, speedControl, returnJson, speed, pitch, textMode } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      const voiceName = voice || "my-MM-NilarNeural";
      const exportFormat = format || "wav";
      const doSlowDown = speedControl === "speed_up_and_down";
      const isSrt = /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(text);
      const isNormalMode = !isSrt && textMode === "normal";
      
      let finalWav: Buffer;
      let allGeneratedItems: { offsetSeconds: number; buffer: Buffer; text: string; }[] = [];
      let speedAdjustments: string[] = [];
      let speedAdjustmentsWithEnd: string[] = [];

      if (isSrt) {
        const srtBlocks = parseSrtRobust(text);
        
        if (srtBlocks.length === 0) {
          return res.status(400).json({ error: "Could not detect valid SRT blocks. Please check formatting." });
        }
        
        for (const block of srtBlocks) {
          if (!block.text.trim()) continue;
          
          const smallChunks = splitTextForSrt(block.text);
          const chunkAudioInfos: { text: string; pcm: Buffer; }[] = [];
          
          for (const chunk of smallChunks) {
            try {
              const pcmBuffer = await getPcmForChunk(chunk, voiceName, speed ? Number(speed) : 1, pitch ? Number(pitch) : 0);
              chunkAudioInfos.push({ text: chunk, pcm: pcmBuffer });
            } catch (err) {
              console.error("Edge TTS chunk error:", err);
            }
          }
          
          if (chunkAudioInfos.length > 0) {
            const blockRawPcm = Buffer.concat(chunkAudioInfos.map(c => c.pcm));
            const actualDuration = blockRawPcm.length / 48000;
            const targetDuration = block.endSeconds - block.startSeconds;
            
            let tempo = 1.0;
            if (targetDuration > 0) {
              tempo = actualDuration / targetDuration;
              if (!doSlowDown && tempo < 1.0) {
                tempo = 1.0;
              }
            }

            const percentage = Math.round((tempo - 1) * 100);
            const sign = percentage > 0 ? '+' : '';
            speedAdjustments.push(`${formatSrtTime(block.startSeconds)} --> ${formatSrtTime(block.endSeconds)} [${sign}${percentage}%]`);
            
            let actualEndSeconds = block.endSeconds;
            if (!doSlowDown && percentage === 0 && actualDuration < targetDuration) {
              actualEndSeconds = block.startSeconds + actualDuration;
            }
            speedAdjustmentsWithEnd.push(`${formatSrtTime(block.startSeconds)} --> ${formatSrtTime(actualEndSeconds)} [${sign}${percentage}%]`);
            
            let currentChunkStart = block.startSeconds;
            for (const cInfo of chunkAudioInfos) {
              let finalPcm = cInfo.pcm;
              if (tempo !== 1.0) {
                finalPcm = await stretchAudioBuffer(cInfo.pcm, tempo);
              }
              const chunkDuration = finalPcm.length / 48000;
              allGeneratedItems.push({
                offsetSeconds: currentChunkStart,
                buffer: finalPcm,
                text: cInfo.text
              });
              currentChunkStart += chunkDuration;
            }
          }
        }

        
        if (allGeneratedItems.length === 0) {
          return res.status(500).json({ error: "TTS generation failed for all blocks." });
        }
        
        let maxBytes = 0;
        for (const item of allGeneratedItems) {
          const byteOffset = Math.floor(item.offsetSeconds * 24000) * 2;
          const endByte = byteOffset + item.buffer.length;
          if (endByte > maxBytes) {
            maxBytes = endByte;
          }
        }
        
        const combinedPcm = Buffer.alloc(maxBytes);
        for (const item of allGeneratedItems) {
          const byteOffset = Math.floor(item.offsetSeconds * 24000) * 2;
          item.buffer.copy(combinedPcm, byteOffset);
        }
        
        const wavHeader = createWavHeader(combinedPcm.length);
        finalWav = Buffer.concat([wavHeader, combinedPcm]);

      } else {
        const chunks = isNormalMode
          ? text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
          : splitIntoChunks(text, 40);
          
        let currentOffset = 0;

        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          try {
            const pcmBuffer = await getPcmForChunk(chunk, voiceName, speed ? Number(speed) : 1, pitch ? Number(pitch) : 0);
            allGeneratedItems.push({
               offsetSeconds: currentOffset,
               buffer: pcmBuffer,
               text: chunk
            });
            currentOffset += pcmBuffer.length / 48000;
          } catch (err) {
            console.error("Edge TTS chunk error:", err);
          }
        }

        if (allGeneratedItems.length === 0) {
          return res.status(500).json({ error: "Failed to generate audio content" });
        }
        
        const combinedPcm = Buffer.concat(allGeneratedItems.map(item => item.buffer));
        const wavHeader = createWavHeader(combinedPcm.length);
        finalWav = Buffer.concat([wavHeader, combinedPcm]);
      }

      let finalAudio = finalWav;
      let contentType = "audio/wav";
      
      if (exportFormat === "mp3") {
         finalAudio = await convertWavToMp3(finalWav);
         contentType = "audio/mpeg";
      }

      if (returnJson) {
        let finalSrtBlocks = [];
        let blockId = 1;
        for (const item of allGeneratedItems) {
           const durationSeconds = item.buffer.length / 48000;
           if (durationSeconds > 0) {
             const start = item.offsetSeconds;
             const end = start + durationSeconds;
             
             const lines = isNormalMode
               ? item.text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
               : splitTextForSubtitles(item.text, 25);

             if (lines.length <= 1) {
               finalSrtBlocks.push(`${blockId++}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${lines[0] || item.text}`);
             } else {
               const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
               const totalDur = durationSeconds;
               let currentStart = start;
               for (const line of lines) {
                 const ratio = line.length / totalChars;
                 let currentEnd = currentStart + (totalDur * ratio);
                 if (currentEnd > end) currentEnd = end;
                 finalSrtBlocks.push(`${blockId++}\n${formatSrtTime(currentStart)} --> ${formatSrtTime(currentEnd)}\n${line}`);
                 currentStart = currentEnd;
               }
             }
           }
        }
        const generatedSrtText = finalSrtBlocks.join("\n\n");
        return res.json({
           audio: `data:${contentType};base64,${finalAudio.toString("base64")}`,
           srt: generatedSrtText,
           speedAdjustments: isSrt ? speedAdjustments : [],
           speedAdjustmentsWithEnd: isSrt ? speedAdjustmentsWithEnd : []
        });
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", finalAudio.length.toString());
      res.send(finalAudio);
    } catch (error: any) {
      console.error("TTS generation error:", error);
      res.status(500).json({ error: error.message || "Something went wrong" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
