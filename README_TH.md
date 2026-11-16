# Goh-Jaeng Sampler — Android Native Audio Starter

## สิ่งที่ทำได้
- แอป Android จริง ไม่ใช่เว็บไซต์ธรรมดา: WebView ใช้เฉพาะ UI และ `AudioService` ใช้ `MediaPlayer` เล่นเสียง
- MD Player เลือกไฟล์เสียงจากเครื่อง เล่นวนซ้ำ (Loop) และเล่นต่อเมื่อออกจากแอป/ล็อกหน้าจอผ่าน foreground service ประเภท mediaPlayback
- Sample Pad 8 ช่อง (กดเพื่อเล่น กดค้างเพื่อเลือกไฟล์), เสียง One-shot สามารถซ้อนกันได้สูงสุด 16 instances
- หยุด MD, หยุดทั้งหมด, Master Volume, จด BPM ได้ (ยังไม่ใช่ Time Stretch)
- บันทึกไฟล์ที่เลือกใน SharedPreferences, ใช้ ACTION_OPEN_DOCUMENT และ persistent read permission
- โค้ดหน้าตาเดิม `original_index.html`, `original_play.css`, `original_play.js` อยู่ใน assets **เพื่อใช้อ้างอิง** ไม่ได้ต่อ Native bridge โดยอัตโนมัติ

## สร้าง APK บน Windows โดยไม่ต้องติดตั้ง Android Studio
1. สร้าง GitHub repository แบบ Private แล้วอัปโหลดทุกไฟล์จากโฟลเดอร์นี้ (รวม `.github/workflows/build-apk.yml`)
2. เข้าแท็บ **Actions** และเปิดใช้งาน workflows ถ้ามีคำเตือน
3. เลือก **Build Android APK** > **Run workflow**
4. เมื่อ Build สำเร็จ เข้าไปที่รอบการทำงาน > **Artifacts** > `GohJaengSampler-debug-apk`
5. แตก ZIP ที่ดาวน์โหลด จะได้ `app-debug.apk` ติดตั้งบนโทรศัพท์ Android (อาจต้องอนุญาต Install unknown apps)

หรือเปิดโฟลเดอร์นี้ใน Android Studio และสั่ง Build > Build APK(s)

## สถานะและข้อจำกัด
- โปรเจกต์นี้ยังไม่ได้คอมไพล์ APK ในสภาพแวดล้อมนี้: ต้อง Build ผ่าน GitHub Actions หรือ Android Studio และทดสอบกับโทรศัพท์จริง
- UI ใหม่มีเฉพาะ MD 1 แทร็ก + 8 sample pads; ยังไม่มี 10 bank sequencer, waveform จากไฟล์จริง, Mark/Cue และ MIDI ของเว็บต้นฉบับ
- BPM ไม่เปลี่ยนความเร็วเสียง/คีย์
- ใช้ Android MediaPlayer: การเริ่มเล่น pad มี latency ได้ และไม่รับประกัน sample-accurate sync; สำหรับเล่นสดที่ต้องการ low latency ให้ย้ายเป็น Oboe/AAudio/PCM engine ในขั้นถัดไป
- ไฟล์ WAV รูปแบบที่ Android รองรับและ MP3/M4A ทั่วไป เปิดผ่าน document picker; ถ้าเครื่องไม่รองรับ codec จะมีข้อผิดพลาด
- การแจ้งเตือนถาวรช่วยคงบริการเสียงไว้ระหว่างสลับแอป แต่การหยุดโดยระบบ, force-stop, นโยบายแบตเตอรี่, การโทรเข้า ยังมีผลได้
- แอปที่ติดตั้งจาก Debug APK ใช้ทดสอบ ไม่ใช่เวอร์ชันส่ง Play Store
