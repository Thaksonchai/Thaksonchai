const BASE_TRACK_NAMES=["KICK","SNARE","C.HAT","O.HAT","CLAP","TOM","PERC","FX"];
const SHORT_NAMES=["KIK","SNR","CH","OH","CLP","TOM","PRC","FX"],BANKS=10,PADS=12,LEGACY_PADS=8,LEGACY_TRACKS=8,TRACKS=36,SAMPLE_PAGE_SIZE=8,SEQ_PAGE_SIZE=4,PROJECT_VERSION=3,MAX_BARS=10,STEPS_BAR=4,BARS_PAGE=4;
const TRACK_NAMES=Array.from({length:TRACKS},(_,i)=>BASE_TRACK_NAMES[i]||`S${String(i+1).padStart(2,'0')}`);
const trackPageCount=size=>Math.ceil(TRACKS/size);
const trackPageOptions=size=>Array.from({length:trackPageCount(size)},(_,i)=>`<option value="${i}">T${i*size+1}–${Math.min((i+1)*size,TRACKS)}</option>`).join('');
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const freshPattern=n=>({name:`PAT ${n+1}`,bars:4,bpm:120,bpmOn:false,steps:Array.from({length:TRACKS},()=>Array(MAX_BARS*STEPS_BAR).fill(0)),doubleSteps:Array.from({length:TRACKS},()=>Array(MAX_BARS*STEPS_BAR).fill(0))});
const freshState=()=>({padsPerBank:PADS,bank:0,active:0,bpm:120,page:"sequence",barPage:0,trackPage:0,samplePage:0,master:100,tracks:TRACK_NAMES.map(name=>({name,file:"กดค้างเพื่อเลือกไฟล์",vol:100,pitch:0,pan:0})),banks:Array.from({length:BANKS},()=>Array.from({length:PADS},(_,i)=>freshPattern(i))),bankBpm:Array(BANKS).fill(120),bankBpmOn:Array(BANKS).fill(false),performBpm:[50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200],midiMap:{}});
function migrate(raw){const s=raw&&typeof raw==="object"?raw:freshState();const d=freshState();s.bank=clamp(Number.isInteger(s.bank)?s.bank:0,0,9);const oldWidth=s.padsPerBank===PADS?PADS:LEGACY_PADS;const oldActive=clamp(s.active,0,BANKS*oldWidth-1);s.active=Number.isInteger(s.active)?Math.floor(oldActive/oldWidth)*PADS+oldActive%oldWidth:s.bank*PADS+clamp(Number.isInteger(s.pattern)?s.pattern:0,0,oldWidth-1);s.padsPerBank=PADS;s.bpm=clamp(+s.bpm||120,50,200);s.page=["sample","sequence","perform","md"].includes(s.page)?s.page:"sequence";s.barPage=clamp(+s.barPage||0,0,8);s.trackPage=clamp(Math.trunc(+s.trackPage||0) ,0,trackPageCount(SEQ_PAGE_SIZE)-1);s.samplePage=clamp(Math.trunc(+s.samplePage||0),0,trackPageCount(SAMPLE_PAGE_SIZE)-1);s.master=clamp(+s.master||100,1,100);s.tracks=Array.from({length:TRACKS},(_,i)=>({...d.tracks[i],...(s.tracks?.[i]||{}),vol:clamp(+(s.tracks?.[i]?.vol??100),1,100),pitch:clamp(+(s.tracks?.[i]?.pitch??0),-12,12),pan:clamp(Math.round(Number(s.tracks?.[i]?.pan)||0),-100,100)}));s.banks=Array.from({length:BANKS},(_,b)=>Array.from({length:PADS},(_,p)=>{const x=s.banks?.[b]?.[p]||d.banks[b][p],f=freshPattern(p);return {...f,...x,bars:clamp(+x.bars||4,1,10),bpm:clamp(+x.bpm||120,50,200),bpmOn:!!x.bpmOn,steps:Array.from({length:TRACKS},(_,t)=>Array.from({length:40},(_,k)=>x.steps?.[t]?.[k]?1:0)),doubleSteps:Array.from({length:TRACKS},(_,t)=>Array.from({length:40},(_,k)=>x.doubleSteps?.[t]?.[k]?1:0))}}));s.bankBpm=Array.from({length:10},(_,i)=>clamp(+(s.bankBpm?.[i]??120),50,200));s.bankBpmOn=Array.from({length:10},(_,i)=>!!s.bankBpmOn?.[i]);s.performBpm=Array.from({length:16},(_,i)=>clamp(+(s.performBpm?.[i]??d.performBpm[i]),50,200));s.midiMap=s.midiMap||{};delete s.pattern;return s}
const state=migrate(JSON.parse(localStorage.getItem("gjSamplerState")||"null"));
let page='perform',selectedTrack=state.samplePage*SAMPLE_PAGE_SIZE,mixerPage=0,doubleEdit=false,running=false,startPending=false,queued=null,step=0,nextTime=0,timer=null,transportEpoch=0;
let ctx,masterGain,buffers=Array(TRACKS).fill(null),activeSources=new Set(),soundsLoaded=false,soundsReady=Promise.resolve(),projectBusy=false,pendingImport=null,fileTrack=0,numberAction=null,numberValue=120,numberFresh=true,midiAccess=null,midiLearning=null;
const activePattern=()=>state.banks[Math.floor(state.active/PADS)][state.active%PADS],persist=()=>localStorage.setItem("gjSamplerState",JSON.stringify(state));

function prepareAudio(){if(!ctx){ctx=new(window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});masterGain=ctx.createGain();masterGain.connect(ctx.destination);ctx.onstatechange=updateAudioStatus}return ctx}
function initAudio(){prepareAudio();masterGain.gain.setTargetAtTime(state.master/100,ctx.currentTime,.004);if(ctx.state==="running"){updateAudioStatus();return Promise.resolve()}const p=ctx.resume();p.then(updateAudioStatus,updateAudioStatus);updateAudioStatus();return p}
function updateAudioStatus(){const ready=ctx?.state==="running";$("#audioUnlock").textContent=ready?(soundsLoaded?"เสียงพร้อมแล้ว":"กำลังโหลดเสียง…"):"แตะเพื่อเปิดเสียง";$("#audioUnlock").classList.toggle("ready",ready&&soundsLoaded);updateControllerStatus()}
const scheduledHits=new Map(),trackPanners=Array(TRACKS).fill(null);
function trackAudioOutput(i){
  if(!ctx.createStereoPanner)return masterGain;
  if(!trackPanners[i]){
    const node=ctx.createStereoPanner();
    node.pan.value=state.tracks[i].pan/100;
    node.connect(masterGain);
    trackPanners[i]=node;
  }
  return trackPanners[i];
}
function updateTrackPan(i){
  trackPanners[i]?.pan.setTargetAtTime(state.tracks[i].pan/100,ctx.currentTime,.008);
}
function stopAllSources(){for(const src of activeSources)try{src.stop()}catch{}activeSources.clear();scheduledHits.clear()}
function cancelFutureHits(now){for(const [src,at] of scheduledHits){if(at<=now)continue;try{src.stop()}catch{}scheduledHits.delete(src);activeSources.delete(src)}}
function playTrack(i,when=0,preview=false,sequenced=false){if(projectBusy||!buffers[i])return;if(ctx?.state!=="running")void initAudio().catch(()=>{});if(preview)stopAllSources();const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buffers[i];src.playbackRate.value=2**(state.tracks[i].pitch/12);gain.gain.value=state.tracks[i].vol/100;src.connect(gain).connect(trackAudioOutput(i));activeSources.add(src);const at=when||ctx.currentTime;if(sequenced)scheduledHits.set(src,at);src.onended=()=>{scheduledHits.delete(src);activeSources.delete(src);try{src.disconnect();gain.disconnect()}catch{}};src.start(at);const pad=$(`.sample-pad[data-track="${i}"]`);if(pad){pad.classList.add("flash");setTimeout(()=>pad.classList.remove("flash"),80)}}
function schedule(){if(!running||!ctx)return;while(nextTime<ctx.currentTime+.1){const pat=activePattern(),len=pat.bars*4,s=step;for(let t=0;t<TRACKS;t++)if(pat.steps[t][s]){playTrack(t,nextTime,false,true);if(pat.doubleSteps[t][s])playTrack(t,nextTime+(60/state.bpm/4)/2,false,true)};markPlayhead(s,nextTime);step++;if(step>=len){step=0;if(queued!==null){state.active=queued;state.bank=Math.floor(queued/PADS);queued=null;const np=activePattern();if(np.bpmOn)state.bpm=np.bpm;renderAll()}}nextTime+=60/state.bpm/4}}
function markPlayhead(s,when){const token=transportEpoch,set=Math.max(0,(when-ctx.currentTime)*1000);setTimeout(()=>{if(!running||token!==transportEpoch)return;if(s%STEPS_BAR===0)$('#playToggle').classList.add('beat-pulse');$$('.step.now').forEach(x=>x.classList.remove('now'));$(`.step[data-step="${s}"]`)?.classList.add('now')},set)}
function beginStart(token){if(projectBusy||running||token!==transportEpoch||ctx.state!=="running")return;startPending=false;running=true;step=0;nextTime=ctx.currentTime;schedule();timer=setInterval(schedule,20);renderTop()}
function start(){if(projectBusy||running||startPending)return;const token=++transportEpoch;startPending=true;try{if(ctx?.state==="running"&&soundsLoaded){beginStart(token);return}Promise.all([initAudio(),soundsReady]).then(()=>beginStart(token)).catch(()=>{if(token===transportEpoch){startPending=false;renderTop()}})}catch(error){startPending=false;renderTop()}}
function stop(){transportEpoch++;startPending=false;running=false;clearInterval(timer);timer=null;queued=null;stopAllSources();$$('.step.now').forEach(x=>x.classList.remove('now'));renderTop();renderPatterns()}
// MIDI messages are discrete actions. Do not discard fast legitimate presses.
// A second press also cancels an asynchronous start before audio is ready.
function toggleTransport(){(running||startPending)?stop():start()}
function restart(){step=0;if(running){transportEpoch++;clearInterval(timer);nextTime=ctx.currentTime;cancelFutureHits(nextTime);$('#playToggle').classList.remove('beat-pulse');schedule();timer=setInterval(schedule,20)}$$('.step.now').forEach(x=>x.classList.remove('now'))}

function renderTop(){const play=$('#playToggle');play.textContent=running?'STOP':'PLAY';play.classList.toggle('is-playing',running);if(!running)play.classList.remove('beat-pulse');$("#bpmButton").textContent=`${state.bpm} BPM`;$("#bankButton").textContent=`BANK ${state.bank+1}`}
function setPage(next){
  if(next==='md'&&page!=='md'){
    stop();
    for(const id of quickVoices.keys())stopQuickFx(id);
  }
  if(page==='md'&&next!=='md')mdDecks.forEach(deck=>deck.pause());
  page=next;state.page=next;$('#pageTitle').textContent=next.toUpperCase();$$('.page,.tab').forEach(x=>x.classList.remove('active'));$(`#${next}Page`).classList.add('active');$(`.tab[data-page="${next}"]`).classList.add('active');$('.app').classList.toggle('sample-mode',(next==='sample'||next==='md'));$('.app').classList.toggle('md-mode',next==='md');renderAll()}
function renderSamplePan(){
  const pan=state.tracks[selectedTrack].pan;
  const value=pan===0?'C':`${pan<0?'L':'R'}${Math.abs(pan)}`;
  $('#samplePan').value=pan;
  $('#samplePan').setAttribute('aria-valuetext',pan===0?'ตรงกลาง':`${pan<0?'ซ้าย':'ขวา'} ${Math.abs(pan)}`);
  $('#samplePanValue').textContent=value;
  $('#panButton').textContent=`PAN ${value}`;
}
function sampleFileName(track){
  const file=track.file;
  if(typeof file!=='string'||!file||file==='กดค้างเพื่อเลือกไฟล์')return track.name;
  return file.replace(/\.[^.]+$/,'')||file;
}
const sampleDisplayName=track=>track.sampleName||sampleFileName(track);
function renderSamples(){renderSamplePan();const start=state.samplePage*SAMPLE_PAGE_SIZE;$('#sampleTracksPage').value=state.samplePage;$("#samplePads").innerHTML=state.tracks.slice(start,start+SAMPLE_PAGE_SIZE).map((t,offset)=>{const i=start+offset;return `<button class="sample-pad ${!buffers[i]?'missing':''} ${i===selectedTrack?'selected':''}" data-track="${i}"><span class="sample-name" title="${escapeHtml(sampleDisplayName(t))}">${escapeHtml(sampleDisplayName(t))}</span><span class="file-pill">${escapeHtml(t.file==='กดค้างเพื่อเลือกไฟล์'?'แตะ FILE เพื่อเลือก':t.file)}</span></button>`}).join('');const t=state.tracks[selectedTrack];$("#volButton").textContent=`VOL ${t.vol}%`;$("#pitchButton").textContent=`PITCH ${t.pitch>=0?'+':''}${t.pitch}`}
function renderSequence(){const p=activePattern(),firstBar=clamp(state.barPage,0,Math.floor((p.bars-1)/4)*4);state.barPage=firstBar;const shown=Math.min(4,p.bars-firstBar),count=shown*4,start=firstBar*4;$("#sequencer").style.setProperty('--steps',count);$("#sequencer").innerHTML=Array.from({length:SEQ_PAGE_SIZE},(_,row)=>{const t=state.trackPage*SEQ_PAGE_SIZE+row;return `<div class="seq-row" style="--steps:${count}"><div class="track-name">${TRACK_NAMES[t]}</div>${Array.from({length:count},(_,k)=>{const s=start+k;return `<button class="step ${p.steps[t][s]?'on':''} ${p.doubleSteps[t][s]?'double':''}" data-track="${t}" data-step="${s}"></button>`}).join('')}</div>`}).join('');$("#tracksPage").value=state.trackPage;const last=firstBar+shown;$("#barsButton").textContent=shown===1?`BAR ${firstBar+1}/${p.bars}`:`${firstBar+1}–${last}/${p.bars} BARS`}
function renderPatterns(){$("#patternPads").innerHTML=state.banks[state.bank].map((p,i)=>{const g=state.bank*PADS+i;return `<button class="pattern-pad ${g===state.active?'current':''} ${g===queued?'queued':''}" data-pad="${i}">${escapeHtml(p.name)}</button>`}).join('')}
function renderBanks(){const seq=page==='sequence';$("#bankTitle").textContent=seq?'SELECT BANK / BANK BPM':'SELECT BANK';$("#bankSettings").hidden=!seq;$("#bankGrid").innerHTML=Array.from({length:10},(_,i)=>`<button type="button" class="${i===state.bank?'active':''}" data-bank="${i}">BANK ${i+1}</button>`).join('');$("#bankBpmToggle").textContent=`BPM ${state.bankBpmOn[state.bank]?'ON':'OFF'}`;$("#bankBpmToggle").classList.toggle('off',!state.bankBpmOn[state.bank]);$("#bankBpmValue").textContent=`${state.bankBpm[state.bank]} BPM`;$("#bankBpmValue").disabled=!state.bankBpmOn[state.bank]}
function renderPadBpm(){const base=state.bank*PADS;$("#padBpmTitle").textContent=`BANK ${state.bank+1} / SELECT PAD`;$("#padBpmGrid").innerHTML=state.banks[state.bank].map((p,i)=>`<button type="button" data-bpm-pad="${i}" class="${base+i===state.active?'active':''}">${escapeHtml(p.name)}</button>`).join('');const p=activePattern();$("#padBpmToggle").textContent=`BPM ${p.bpmOn?'ON':'OFF'}`;$("#padBpmToggle").classList.toggle('off',!p.bpmOn);$("#padBpmValue").textContent=`${p.bpm} BPM`;$("#padBpmValue").disabled=!p.bpmOn}
const mixerSizeObserver=new ResizeObserver(([entry])=>{
  if(entry.contentRect.height>0){
    $('#mixerChannels').style.setProperty('--fader-length',entry.contentRect.height+'px');
  }
});
const mixerLevel=value=>`${(value-1)*100/99}%`;
function renderMixer(){
  const start=mixerPage*SAMPLE_PAGE_SIZE;
  $('#mixerTracksPage').value=mixerPage;
  const tracks=state.tracks.slice(start,start+SAMPLE_PAGE_SIZE).map((track,offset)=>{
    const index=start+offset;
    return {name:SHORT_NAMES[index]||TRACK_NAMES[index],label:track.name,value:track.vol,index};
  });
  tracks.push({name:'MST',label:'MASTER',value:state.master,index:TRACKS});
  $('#mixerChannels').innerHTML=tracks.map(({name,label,value,index})=>`
    <label class="channel ${index===TRACKS?'master':''}" style="--level:${mixerLevel(value)}">
      <output for="mixer-fader-${index}">${value}%</output>
      <span class="fader-slot">
        <span class="fader-rail" aria-hidden="true"></span>
        <input id="mixer-fader-${index}" class="mixer-fader" type="range" min="1" max="100" step="1"
          value="${value}" data-mix="${index}" aria-label="${escapeHtml(label)}" aria-orientation="vertical">
      </span>
      <span class="channel-name">${name}</span>
    </label>`).join('');
  mixerSizeObserver.disconnect();
  mixerSizeObserver.observe($('#mixerChannels .fader-slot'));
}
function renderAll(save=true){renderTop();renderSamples();renderSequence();renderPatterns();renderBanks();renderPadBpm();if(save)persist()}

let remoteRenderPending=false, remoteSaveTimer=null;
function flushRemoteSave(){
  if(remoteSaveTimer===null)return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer=null;
  if(!projectBusy)persist();
}
window.addEventListener('pagehide',flushRemoteSave);
function renderRemotePattern(){
  renderTop();
  renderPatterns();
  if(!remoteRenderPending){
    remoteRenderPending=true;
    requestAnimationFrame(()=>{remoteRenderPending=false;renderSequence();renderBanks();renderPadBpm()});
  }
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer=setTimeout(flushRemoteSave,250);
}
function selectPattern(local,bank=state.bank,remote=false){const bankChanged=bank!==state.bank;state.bank=bank;const bankTempo=bankChanged&&state.bankBpmOn[bank];if(bankTempo)state.bpm=state.bankBpm[bank];const global=bank*PADS+local;if(running)queued=global;else{state.active=global;const p=activePattern();if(!bankTempo&&p.bpmOn)state.bpm=p.bpm;state.barPage=0;queued=null}if(remote)renderRemotePattern();else renderAll()}
function selectBank(bank){const same=bank===state.bank;state.bank=bank;if(state.bankBpmOn[bank])state.bpm=state.bankBpm[bank];if(page==='sequence'&&same){renderPadBpm();$("#bankDialog").close();$("#padBpmDialog").showModal();return}if(!running){state.active=bank*PADS;const p=activePattern();if(!state.bankBpmOn[bank]&&p.bpmOn)state.bpm=p.bpm;state.barPage=0;queued=null}renderAll();if(page==='perform')$("#bankDialog").close()}
function changeBpm(delta){state.bpm=clamp(state.bpm+delta,50,200);if(page==='sequence'&&activePattern().bpmOn)activePattern().bpm=state.bpm;renderAll()}
let lastTempoTap=null;
const tempoTapIntervals=[];
function tapTempo(time){
  const interval=lastTempoTap===null?Infinity:time-lastTempoTap;
  if(interval<300)return;
  lastTempoTap=time;
  if(interval>1200){tempoTapIntervals.length=0;return}
  tempoTapIntervals.push(interval);
  if(tempoTapIntervals.length>4)tempoTapIntervals.shift();
  const bpm=Math.round(60000*tempoTapIntervals.length/tempoTapIntervals.reduce((sum,ms)=>sum+ms,0));
  if(bpm!==state.bpm)changeBpm(bpm-state.bpm);
}
function adjustSound(kind,delta){const t=state.tracks[selectedTrack];if(kind==='vol')t.vol=clamp(t.vol+delta,1,100);else t.pitch=clamp(t.pitch+delta,-12,12);persist();renderSamples();playTrack(selectedTrack,0,true)}

function openNumber(title,value,suffix,callback){numberAction=callback;numberValue=value;numberFresh=true;$("#numberTitle").textContent=title;$("#numberDisplay").dataset.suffix=suffix;renderNumber();$("#numberDialog").showModal()}
function renderNumber(){$("#numberDisplay").textContent=`${numberValue}${$("#numberDisplay").dataset.suffix||''}`}
function numberKey(k){if(k==='DEL'){numberFresh=false;numberValue=Math.floor(numberValue/10)}else{const n=numberFresh?+k:numberValue*10+(+k);numberFresh=false;if(n<=200)numberValue=n}renderNumber()}
function openBpm(mode,slot=-1){let title='ENTER BPM (50–200)',value=state.bpm,cb=v=>{if(mode==='bank'){state.bankBpm[state.bank]=v;if(!running&&Math.floor(state.active/PADS)===state.bank&&!activePattern().bpmOn)state.bpm=v}else{state.bpm=v;if(mode==='live'&&page==='sequence'&&activePattern().bpmOn)activePattern().bpm=v;else if(mode==='pad')activePattern().bpm=v;else if(mode==='slot')state.performBpm[slot]=v}renderAll()};if(mode==='bank'){title='SET BANK BPM (50–200)';value=state.bankBpm[state.bank]}if(mode==='slot'){title='SET BPM SLOT (50–200)';value=state.performBpm[slot]}openNumber(title,value,' BPM',cb)}

function renderPerformBpm(){$("#performBpmGrid").innerHTML=state.performBpm.map((v,i)=>`<button type="button" data-bpm-slot="${i}" class="${v===state.bpm?'active':''}">${v} BPM</button>`).join('')}
function applyBpmSlot(i){state.bpm=state.performBpm[i];persist();renderAll();$("#performBpmDialog").close()}

const MIDI_ACTIONS=[...TRACK_NAMES.map((n,i)=>({id:`sample${i}`,label:`SAMPLE ${i+1} · ${n}`})),...Array.from({length:PADS},(_,i)=>({id:`pattern${i}`,label:`PAD ${i+1}`})),{id:'play',label:'PLAY / STOP'},{id:'restart',label:'กลับ BAR 1'},{id:'bankPrev',label:'BANK ก่อนหน้า'},{id:'bankNext',label:'BANK ถัดไป'}];
function midiMapText(m,id){if(m)return `${m.type.toUpperCase()} ${m.number} · CH ${m.channel}`;if(id==='play')return 'NOTE 8 · CH 10 (PLAY / STOP)';if(id.startsWith('pattern'))return `P${+id.slice(7)+1} · BANK 1–9 · CH 10`;return 'ยังไม่ตั้ง'}
function renderMidi(){$("#midiMappings").innerHTML=MIDI_ACTIONS.map(a=>`<div class="midi-row"><b>${a.label}</b><span class="midi-value">${midiMapText(state.midiMap[a.id],a.id)}</span><button type="button" data-learn="${a.id}">${midiLearning===a.id?'กดปุ่ม…':'LEARN'}</button></div>`).join('')}
function runMidi(id){if(id.startsWith('sample'))playTrack(+id.slice(6),0,true);else if(id.startsWith('pattern'))selectPattern(+id.slice(7));else if(id==='play')toggleTransport();else if(id==='restart')restart();else if(id==='bankPrev')selectBank((state.bank+9)%10);else if(id==='bankNext')selectBank((state.bank+1)%10)}
let midiTempoSaveTimer;
function onMidi(e){
  if(page==='md')return;
  const [st,n,v]=e.data;
  if(st===0xB9&&n===32&&Number.isInteger(v)&&v>=0&&v<9){
    if(v!==state.bank)selectBank(v);
    return;
  }
  // Goh-Jaeng firmware sends absolute tempo: CC 0, MIDI channel 10,
  // with 0–127 representing 50–200 BPM. Zero is a valid tempo value.
  if(st===0xB9&&n===0&&Number.isInteger(v)&&v>=0&&v<=127){
    const bpm=50+Math.round(v*150/127);
    if(bpm!==state.bpm){
      state.bpm=bpm;
      renderTop();
      clearTimeout(midiTempoSaveTimer);
      midiTempoSaveTimer=setTimeout(persist,200);
    }
    return;
  }
  const type=(st&0xf0)===0x90&&v>0?'note':(st&0xf0)===0xb0&&v>0?'cc':null;
  if(!type)return;
  const m={type,number:n,channel:(st&15)+1};
  if(midiLearning){state.midiMap[midiLearning]=m;midiLearning=null;persist();renderMidi();return}
  for(const [id,x] of Object.entries(state.midiMap))
    if(x?.type===type&&x.number===n&&x.channel===m.channel){runMidi(id);return}
  if(type!=='note'||m.channel!==10)return;
  if(n===8){if(!state.midiMap.play)toggleTransport();return}
  if(n===110){if(!state.midiMap.restart)restart();return}
  // The controller numbers the 12 buttons across banks, skipping Note 8.
  if(!Number.isInteger(n)||n<1||n>9*PADS+1)return;
  const index=n-(n>8?2:1), local=index%PADS;
  if(!state.midiMap[`pattern${local}`])selectPattern(local,Math.floor(index/PADS),true);
}
function midiInputs(access){
  const inputs=access&&access.inputs,ports=[];
  const add=p=>{if(p&&typeof p==='object'&&!ports.includes(p))ports.push(p)};
  if(!inputs)return ports;
  if(typeof inputs==='function'){Array.from(inputs.call(access)||[]).forEach(add);return ports}
  if(typeof inputs.forEach==='function')inputs.forEach(add);
  else if(typeof inputs.values==='function')Array.from(inputs.values()).forEach(add);
  else if(Array.isArray(inputs)||typeof inputs.length==='number')Array.from(inputs).forEach(add);
  else Object.keys(inputs).forEach(k=>add(inputs[k]));
  return ports.filter(p=>p.state!=='disconnected');
}
function bindMidiInputs(){
  const ports=midiInputs(midiAccess);
  controllerOnline=ports.length>0;
  updateControllerStatus();
  ports.forEach(input=>{
    input.onmidimessage=onMidi;
    if(typeof input.open==='function')Promise.resolve(input.open()).catch(error=>{
      $('#midiStatus').textContent=`เปิด MIDI ไม่สำเร็จ: ${error.message||error.name||error}`;
    });
  });
  $('#midiStatus').textContent=ports.length?`เชื่อมต่อแล้ว ${ports.length} อุปกรณ์ · ${ports.map(p=>p.name||'MIDI Input').join(', ')}`:'เชื่อมต่อ MIDI แล้ว แต่ยังไม่พบอุปกรณ์ — เชื่อม Bluetooth MIDI ในเมนูของแอป แล้วกดเชื่อมต่ออีกครั้ง';
  return ports.length>0;
}
let midiConnectPending=null;
function connectMidi(){
  if(!midiConnectPending)midiConnectPending=requestMidiConnection().finally(()=>{midiConnectPending=null});
  return midiConnectPending;
}
async function requestMidiConnection(){
  if(typeof navigator.requestMIDIAccess!=='function'){controllerOnline=false;updateControllerStatus();$('#midiStatus').textContent='เบราว์เซอร์นี้ไม่มี Web MIDI — บน iOS ให้เปิดผ่าน Web MIDI Browser';return false}
  $('#midiStatus').textContent='กำลังเชื่อมต่อ MIDI…';
  try{
    // Explicit options also support iOS Web MIDI bridges which expect an
    // options object. SysEx is unnecessary for CC/Note mapping.
    midiAccess=await navigator.requestMIDIAccess({sysex:false});
  }catch(error){
    controllerOnline=false;updateControllerStatus();
    midiLearning=null;renderMidi();
    $('#midiStatus').textContent=`ขอเชื่อมต่อ MIDI ไม่สำเร็จ: ${error.name||'Error'} — ${error.message||String(error)}`;
    return false;
  }
  try{midiAccess.onstatechange=bindMidiInputs;return bindMidiInputs()}
  catch(error){$('#midiStatus').textContent=`เชื่อมต่อแล้ว แต่อ่านอุปกรณ์ไม่สำเร็จ: ${error.message||error}`;return false}
}
async function learnMidi(action){
  if(!midiAccess||!midiInputs(midiAccess).length){if(!await connectMidi())return}
  midiLearning=action;renderMidi();
  $('#midiStatus').textContent='พร้อมรับ MIDI · กดปุ่มบนตัวส่งเพื่อจับคู่';
}

const dbp=new Promise((resolve,reject)=>{const r=indexedDB.open('gj-web-sampler',1);r.onupgradeneeded=()=>r.result.createObjectStore('sounds');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function dbGet(k){const db=await dbp;return new Promise((res,rej)=>{const r=db.transaction('sounds').objectStore('sounds').get(k);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}
async function dbPut(k,v){const db=await dbp;return new Promise((res,rej)=>{const tx=db.transaction('sounds','readwrite');tx.objectStore('sounds').put(v,k);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function dbReplaceAll(values){const db=await dbp;return new Promise((res,rej)=>{const tx=db.transaction('sounds','readwrite'),store=tx.objectStore('sounds');values.forEach((v,i)=>v?store.put(v,i):store.delete(i));tx.oncomplete=res;tx.onabort=tx.onerror=()=>rej(tx.error||new Error('บันทึกเสียงไม่สำเร็จ'))})}
function bytesToBase64(buf){const b=new Uint8Array(buf);let x='';for(let i=0;i<b.length;i+=32768)x+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(x)}
function base64ToBlob(data,type){const x=atob(data),b=new Uint8Array(x.length);for(let i=0;i<x.length;i++)b[i]=x.charCodeAt(i);return new Blob([b],{type:type||'audio/wav'})}
function projectStatus(x,bad=false){$("#projectStatus").textContent=x;$("#projectStatus").style.color=bad?'#ff92aa':''}
async function exportProject(){if(projectBusy)return;projectBusy=true;projectStatus('กำลังรวมไฟล์เสียง…');try{const sounds=[];for(let i=0;i<TRACKS;i++){const b=await dbGet(i);sounds.push(b?{name:state.tracks[i].file,type:b.type,data:bytesToBase64(await b.arrayBuffer())}:null)}const blob=new Blob([JSON.stringify({format:'GJ-WEB-SAMPLER',version:PROJECT_VERSION,state,sounds})],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`GJ-Sampler-V71-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);projectStatus('EXPORT สำเร็จ — ใช้ไฟล์นี้ IMPORT อีกเครื่องได้')}catch(e){projectStatus('EXPORT ไม่สำเร็จ: '+e.message,true)}finally{projectBusy=false}}
async function inspectImport(file){try{const p=JSON.parse(await file.text());if(p.format!=='GJ-WEB-SAMPLER'||![1,2,PROJECT_VERSION].includes(p.version)||!Array.isArray(p.sounds)||p.sounds.length!==(p.version===PROJECT_VERSION?TRACKS:LEGACY_TRACKS))throw Error('ไฟล์ PROJECT ไม่ถูกต้อง');pendingImport={...p,state:migrate(p.state)};$("#projectActions").hidden=true;$("#importReview").hidden=false;$("#importFileName").textContent=file.name;$("#importSummary").textContent=`${BANKS} BANK · ${BANKS*PADS} PAT · เสียง ${p.sounds.filter(Boolean).length}/${TRACKS} ช่อง`;projectStatus('ตรวจไฟล์แล้ว กดยืนยันเพื่อนำเข้า')}catch(e){projectStatus(e.message,true)}}
async function confirmImport(){if(!pendingImport||projectBusy)return;projectBusy=true;stop();const oldSaved=localStorage.getItem('gjSamplerState');let staged=false;try{initAudio().catch(()=>{});await soundsReady;const next=pendingImport.state,newBuffers=Array(TRACKS).fill(null),blobs=Array(TRACKS).fill(null);for(let i=0;i<TRACKS;i++)if(pendingImport.sounds[i]){const x=pendingImport.sounds[i];blobs[i]=base64ToBlob(x.data,x.type);newBuffers[i]=await ctx.decodeAudioData(await blobs[i].arrayBuffer())}localStorage.setItem('gjSamplerState',JSON.stringify(next));staged=true;try{await dbReplaceAll(blobs)}catch(e){oldSaved===null?localStorage.removeItem('gjSamplerState'):localStorage.setItem('gjSamplerState',oldSaved);throw e}Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,next);trackPanners.forEach((_,i)=>updateTrackPan(i));buffers=newBuffers;selectedTrack=state.samplePage*SAMPLE_PAGE_SIZE;pendingImport=null;$("#importReview").hidden=true;$("#projectActions").hidden=false;renderAll(false);projectStatus('IMPORT สำเร็จ — จังหวะและเสียงพร้อมใช้งาน')}catch(e){if(staged&&pendingImport){try{oldSaved===null?localStorage.removeItem('gjSamplerState'):localStorage.setItem('gjSamplerState',oldSaved)}catch{}}projectStatus('IMPORT ไม่สำเร็จ: '+e.message+' — ข้อมูลเดิมยังอยู่',true)}finally{projectBusy=false}}
async function loadSounds(){
  const blobs=await Promise.all(Array.from({length:TRACKS},(_,i)=>dbGet(i)));
  if(blobs.some(Boolean)){
    prepareAudio();
    for(let start=0;start<TRACKS;start+=4){
      await Promise.all(blobs.slice(start,start+4).map(async(b,i)=>{
        if(b)try{const decoded=await ctx.decodeAudioData(await b.arrayBuffer());if(!buffers[start+i])buffers[start+i]=decoded}catch{}
      }));
    }
  }
  soundsLoaded=true;updateAudioStatus();renderSamples();
}

const patternGrid=$('#patternPads'),padClipboardDialog=$('#padClipboardDialog');
let patternPress=null,heldPatternButton=null,padClipboard=null,padClipboardTarget=null;

function cancelPatternHold(){
  if(patternPress)clearTimeout(patternPress.timer);
  patternPress=null;
}
patternGrid.addEventListener('pointerdown',e=>{
  const button=e.target.closest('[data-pad]');
  if(!button||!e.isPrimary||e.button!==0)return;
  cancelPatternHold();
  heldPatternButton=null;
  const bank=state.bank,index=Number(button.dataset.pad);
  const press={pointerId:e.pointerId,x:e.clientX,y:e.clientY};
  patternPress=press;
  press.timer=setTimeout(()=>{
    if(patternPress!==press||!button.isConnected||projectBusy||padClipboardDialog.open)return;
    heldPatternButton=button;
    padClipboardTarget={bank,index};
    $('#padClipboardTitle').textContent=`BANK ${bank+1} · PAD ${index+1} · ${state.banks[bank][index].name}`;
    $('#padClipboardSource').textContent=padClipboard?`คัดลอกไว้: ${padClipboard.name}`:'';
    $('#pastePatternPad').disabled=!padClipboard;
    padClipboardDialog.showModal();
  },550);
});
patternGrid.addEventListener('pointermove',e=>{
  if(patternPress?.pointerId===e.pointerId&&Math.hypot(e.clientX-patternPress.x,e.clientY-patternPress.y)>10)cancelPatternHold();
});
for(const event of ['pointerup','pointercancel','pointerleave'])document.addEventListener(event,e=>{
  if(patternPress?.pointerId===e.pointerId)cancelPatternHold();
},true);
patternGrid.addEventListener('contextmenu',e=>{
  if(e.target.closest('[data-pad]'))e.preventDefault();
});
patternGrid.addEventListener('click',e=>{
  if(heldPatternButton&&e.target.closest('[data-pad]')===heldPatternButton){
    heldPatternButton=null;
    e.stopPropagation();
  }
});

const clonePattern=pattern=>JSON.parse(JSON.stringify(pattern));
$('#copyPatternPad').onclick=()=>{
  if(projectBusy||!padClipboardTarget)return;
  const {bank,index}=padClipboardTarget;
  padClipboard=clonePattern(state.banks[bank][index]);
  padClipboardDialog.close();
};
$('#pastePatternPad').onclick=()=>{
  if(projectBusy||!padClipboard||!padClipboardTarget)return;
  const {bank,index}=padClipboardTarget;
  const pattern=clonePattern(padClipboard);
  state.banks[bank][index]=pattern;
  if(state.active===bank*PADS+index){
    if(step>=pattern.bars*STEPS_BAR)step=0;
    if(!running&&pattern.bpmOn)state.bpm=pattern.bpm;
  }
  renderAll();
  padClipboardDialog.close();
};

const sampleGrid=$('#samplePads'),sampleNameDialog=$('#sampleNameDialog');
let samplePress=null,heldSamplePad=null,renameTrack=null;
function cancelSampleHold(){
  if(samplePress)clearTimeout(samplePress.timer);
  samplePress=null;
}
sampleGrid.addEventListener('pointerdown',e=>{
  const pad=e.target.closest('.sample-pad');
  if(!pad||!e.isPrimary||e.button!==0)return;
  cancelSampleHold();
  heldSamplePad=null;
  if(e.target.closest('.file-pill'))return;
  const press={id:e.pointerId,x:e.clientX,y:e.clientY};
  samplePress=press;
  press.timer=setTimeout(()=>{
    if(samplePress!==press||!pad.isConnected||sampleNameDialog.open||projectBusy)return;
    heldSamplePad=pad;
    renameTrack=Number(pad.dataset.track);
    const track=state.tracks[renameTrack];
    $('#sampleNameInput').value=sampleDisplayName(track);
    sampleNameDialog.showModal();
  },550);
});
sampleGrid.addEventListener('pointermove',e=>{
  if(samplePress?.id===e.pointerId&&Math.hypot(e.clientX-samplePress.x,e.clientY-samplePress.y)>10)cancelSampleHold();
});
for(const event of ['pointerup','pointercancel','pointerleave'])document.addEventListener(event,e=>{
  if(samplePress?.id===e.pointerId)cancelSampleHold();
},true);
sampleGrid.addEventListener('contextmenu',e=>{
  if(e.target.closest('.sample-pad'))e.preventDefault();
});
sampleGrid.addEventListener('click',e=>{
  if(heldSamplePad&&e.target.closest('.sample-pad')===heldSamplePad){
    heldSamplePad=null;
    e.stopPropagation();
  }
});
function saveSampleName(name){
  if(renameTrack===null||projectBusy)return;
  const track=state.tracks[renameTrack];
  track.sampleName=name===sampleFileName(track)?'':name;
  persist();
  renderSamples();
  sampleNameDialog.close();
}
$('#sampleNameForm').onsubmit=e=>{
  e.preventDefault();
  saveSampleName($('#sampleNameInput').value.trim());
};
$('#sampleUseFileName').onclick=()=>saveSampleName('');
$('#sampleNameCancel').onclick=()=>sampleNameDialog.close();
sampleNameDialog.addEventListener('close',()=>{renameTrack=null});

document.addEventListener('click',e=>{const tab=e.target.closest('[data-page]');if(tab){$('#webMenuDialog').close();setPage(tab.dataset.page);return}const file=e.target.closest('.file-pill');if(file){e.stopPropagation();fileTrack=+file.closest('.sample-pad').dataset.track;$("#fileInput").click();return}const pad=e.target.closest('.sample-pad');if(pad){selectedTrack=+pad.dataset.track;renderSamples();playTrack(selectedTrack,0,true);return}const cell=e.target.closest('.step');if(cell){const p=activePattern(),t=+cell.dataset.track,s=+cell.dataset.step;if(doubleEdit){if(!p.steps[t][s]){p.steps[t][s]=1;p.doubleSteps[t][s]=1}else p.doubleSteps[t][s]^=1}else{p.steps[t][s]^=1;if(!p.steps[t][s])p.doubleSteps[t][s]=0}persist();renderSequence();return}const pp=e.target.closest('[data-pad]');if(pp){selectPattern(+pp.dataset.pad);return}const bank=e.target.closest('[data-bank]');if(bank){selectBank(+bank.dataset.bank);return}const bp=e.target.closest('[data-bpm-pad]');if(bp&&!running){state.active=state.bank*PADS+(+bp.dataset.bpmPad);if(activePattern().bpmOn)state.bpm=activePattern().bpm;renderAll();return}const learn=e.target.closest('[data-learn]');if(learn){learnMidi(learn.dataset.learn)}});

$("#playToggle").addEventListener('pointerdown',e=>{e.preventDefault();toggleTransport()});$("#restart").addEventListener('pointerdown',e=>{e.preventDefault();restart()});
$("#tapTempo").onclick=e=>tapTempo(e.timeStamp);
$('#playToggle').addEventListener('animationend',e=>{if(e.animationName==='play-beat')e.currentTarget.classList.remove('beat-pulse')});
const sequenceLock=$('#sequenceLock');
let sequenceLocked=false,lockPress=null,ignoreLockClick=false;
function setSequenceLock(locked){
  sequenceLocked=locked;
  $('#sequencer').inert=locked;
  sequenceLock.textContent=locked?'🔒':'🔓';
  sequenceLock.title=locked?'กดค้างเพื่อปลดล็อก':'แตะเพื่อล็อก';
  sequenceLock.setAttribute('aria-pressed',String(locked));
}
sequenceLock.addEventListener('click',e=>{
  if(ignoreLockClick&&e.detail!==0){ignoreLockClick=false;return}
  if(!sequenceLocked)setSequenceLock(true);
});
sequenceLock.addEventListener('pointerdown',e=>{
  if(!e.isPrimary||e.button!==0)return;
  ignoreLockClick=false;
  if(!sequenceLocked)return;
  lockPress={id:e.pointerId,time:e.timeStamp,x:e.clientX,y:e.clientY};
  sequenceLock.setPointerCapture(e.pointerId);
});
sequenceLock.addEventListener('pointermove',e=>{
  if(lockPress?.id===e.pointerId&&Math.hypot(e.clientX-lockPress.x,e.clientY-lockPress.y)>18)lockPress=null;
});
sequenceLock.addEventListener('pointerup',e=>{
  if(lockPress?.id!==e.pointerId)return;
  const held=e.timeStamp-lockPress.time>=700;
  lockPress=null;
  if(held){ignoreLockClick=true;setSequenceLock(false)}
});
for(const event of ['pointercancel','lostpointercapture'])sequenceLock.addEventListener(event,()=>{lockPress=null});
sequenceLock.addEventListener('contextmenu',e=>e.preventDefault());
let lockKeyTime=null;
sequenceLock.addEventListener('keydown',e=>{
  if(!sequenceLocked||![' ','Enter'].includes(e.key))return;
  e.preventDefault();if(!e.repeat)lockKeyTime=e.timeStamp;
});
sequenceLock.addEventListener('keyup',e=>{
  if(!sequenceLocked||![' ','Enter'].includes(e.key))return;
  e.preventDefault();
  if(lockKeyTime!==null&&e.timeStamp-lockKeyTime>=700)setSequenceLock(false);
  lockKeyTime=null;
});
sequenceLock.addEventListener('blur',()=>{lockKeyTime=null});
setSequenceLock(true);
$("#bpmMinus").onclick=()=>changeBpm(-1);$("#bpmPlus").onclick=()=>changeBpm(1);$("#bpmButton").onclick=()=>{if(page==='perform'){renderPerformBpm();$("#performBpmDialog").showModal()}else openBpm('live')};
$("#bankButton").onclick=()=>{renderBanks();$("#bankDialog").showModal()};$("#tracksPage").innerHTML=trackPageOptions(SEQ_PAGE_SIZE);$("#tracksPage").onchange=e=>{state.trackPage=+e.target.value;renderSequence();persist()};
$("#sampleTracksPage").innerHTML=trackPageOptions(SAMPLE_PAGE_SIZE);$("#sampleTracksPage").onchange=e=>{state.samplePage=+e.target.value;selectedTrack=state.samplePage*SAMPLE_PAGE_SIZE;renderSamples();persist()};
$("#barPrev").onclick=()=>{const last=Math.floor((activePattern().bars-1)/4)*4;state.barPage=state.barPage?state.barPage-4:last;renderSequence();persist()};$("#barNext").onclick=()=>{const last=Math.floor((activePattern().bars-1)/4)*4;state.barPage=state.barPage>=last?0:state.barPage+4;renderSequence();persist()};
$("#barsButton").onclick=()=>{$("#barsDisplay").textContent=activePattern().bars===1?'1 BAR':`${activePattern().bars} BARS`;$("#doubleEdit").textContent=`DOUBLE EDIT: ${doubleEdit?'ON':'OFF'}`;$("#barDialog").showModal()};
$("#barsPlus").onclick=()=>{const p=activePattern();p.bars=clamp(p.bars+1,1,10);$("#barsDisplay").textContent=p.bars===1?'1 BAR':`${p.bars} BARS`;renderSequence();persist()};$("#barsMinus").onclick=()=>{const p=activePattern();p.bars=clamp(p.bars-1,1,10);state.barPage=Math.min(state.barPage,Math.floor((p.bars-1)/4)*4);$("#barsDisplay").textContent=p.bars===1?'1 BAR':`${p.bars} BARS`;renderSequence();persist()};$("#doubleEdit").onclick=()=>{doubleEdit=!doubleEdit;$("#doubleEdit").textContent=`DOUBLE EDIT: ${doubleEdit?'ON':'OFF'}`};
$("#savePattern").onclick=()=>{if(running)stop();$("#patternName").value=activePattern().name;$("#saveDialog").showModal();setTimeout(()=>$("#patternName").focus(),30)};$("#saveOk").onclick=()=>{activePattern().name=$("#patternName").value.trim()||activePattern().name;persist();renderAll()};
function setSamplePan(value,save=true){
  state.tracks[selectedTrack].pan=clamp(value,-100,100);
  updateTrackPan(selectedTrack);
  renderSamplePan();
  if(save)persist();
}
$('#panMinus').onclick=()=>setSamplePan(state.tracks[selectedTrack].pan-1);
$('#panPlus').onclick=()=>setSamplePan(state.tracks[selectedTrack].pan+1);
$('#panButton').onclick=()=>$('#samplePanDialog').showModal();
$('#panCenter').onclick=()=>setSamplePan(0);
$('#samplePan').addEventListener('input',e=>setSamplePan(Number(e.target.value),false));
$('#samplePan').addEventListener('change',persist);
$("#volMinus").onclick=()=>adjustSound('vol',-1);$("#volPlus").onclick=()=>adjustSound('vol',1);$("#pitchMinus").onclick=()=>adjustSound('pitch',-1);$("#pitchPlus").onclick=()=>adjustSound('pitch',1);$("#volButton").onclick=()=>openNumber('SET PAD VOLUME (1–100%)',state.tracks[selectedTrack].vol,'%',v=>{state.tracks[selectedTrack].vol=clamp(v,1,100);renderSamples();persist()});
$("#numberDel").onclick=()=>numberKey('DEL');$("#keypad").innerHTML=[1,2,3,4,5,6,7,8,9,0].map(n=>`<button type="button" data-number="${n}">${n}</button>`).join('');$("#keypad").onclick=e=>{if(e.target.dataset.number!==undefined)numberKey(e.target.dataset.number)};$("#numberOk").onclick=()=>{numberAction?.(clamp(numberValue,$("#numberTitle").textContent.includes('VOLUME')?1:50,$("#numberTitle").textContent.includes('VOLUME')?100:200));persist()};
$("#bankBpmToggle").onclick=()=>{state.bankBpmOn[state.bank]=!state.bankBpmOn[state.bank];renderBanks();persist();if(state.bankBpmOn[state.bank])openBpm('bank')};$("#bankBpmValue").onclick=()=>openBpm('bank');
$("#padBpmToggle").onclick=()=>{const p=activePattern();p.bpmOn=!p.bpmOn;renderPadBpm();persist();if(p.bpmOn)openBpm('pad')};$("#padBpmValue").onclick=()=>openBpm('pad');
$("#performBpmGrid").addEventListener('pointerdown',e=>{const b=e.target.closest('[data-bpm-slot]');if(!b)return;const i=+b.dataset.bpmSlot;b.dataset.long='0';b._hold=setTimeout(()=>{b.dataset.long='1';openBpm('slot',i)},600)});$("#performBpmGrid").addEventListener('pointerup',e=>{const b=e.target.closest('[data-bpm-slot]');if(!b)return;clearTimeout(b._hold);if(b.dataset.long!=='1')applyBpmSlot(+b.dataset.bpmSlot)});$("#enterBpm").onclick=()=>{openBpm('live');$("#performBpmDialog").close()};
$("#mixerOpen").onclick=()=>{mixerPage=state.samplePage;renderMixer();$("#mixerDialog").showModal()};$("#mixerTracksPage").innerHTML=trackPageOptions(SAMPLE_PAGE_SIZE);$("#mixerTracksPage").onchange=e=>{mixerPage=+e.target.value;renderMixer()};$('#mixerChannels').addEventListener('input',e=>{
  const input=e.target;
  if(!input.matches('.mixer-fader'))return;
  const index=Number(input.dataset.mix),value=Number(input.value);
  if(index===TRACKS){
    state.master=value;
    if(masterGain)masterGain.gain.setTargetAtTime(value/100,ctx.currentTime,.004);
  }else state.tracks[index].vol=value;
  const channel=input.closest('.channel');
  channel.style.setProperty('--level',mixerLevel(value));
  channel.querySelector('output').textContent=`${value}%`;
});
$('#mixerChannels').addEventListener('change',()=>{
  persist();
  renderSamples();
});
$("#webMenuOpen").onclick=()=>$("#webMenuDialog").showModal();$("#projectOpen").onclick=()=>{$("#webMenuDialog").close();$("#projectDialog").showModal()};$("#midiOpen").onclick=()=>{$("#webMenuDialog").close();renderMidi();$("#midiDialog").showModal();connectMidi()};$("#clearPattern").onclick=()=>{activePattern().steps.forEach(x=>x.fill(0));activePattern().doubleSteps.forEach(x=>x.fill(0));persist();renderSequence();$("#webMenuDialog").close()};
$("#midiConnect").onclick=connectMidi;$("#midiClear").onclick=()=>{state.midiMap={};midiLearning=null;persist();renderMidi()};
$("#audioUnlock").onclick=initAudio;$("#fileInput").onchange=async e=>{const f=e.target.files[0],track=fileTrack;if(!f)return;try{await initAudio();const b=await ctx.decodeAudioData(await f.arrayBuffer());await dbPut(track,f);buffers[track]=b;state.tracks[track].file=f.name;if(Math.floor(track/SAMPLE_PAGE_SIZE)===state.samplePage)selectedTrack=track;persist();renderSamples();playTrack(track,0,true)}catch{alert('อ่านไฟล์เสียงไม่ได้ กรุณาใช้ WAV, MP3, M4A หรือ OGG')}e.target.value=''};
$("#exportProject").onclick=exportProject;$("#importProject").onclick=()=>$("#projectInput").click();$("#projectInput").onchange=e=>{if(e.target.files[0])inspectImport(e.target.files[0]);e.target.value=''};$("#importConfirm").onclick=confirmImport;$("#importCancel").onclick=()=>{pendingImport=null;$("#importReview").hidden=true;$("#projectActions").hidden=false;projectStatus('ยกเลิก IMPORT แล้ว')};

const quickKey='gjSamplerPerformTools',quickLimit=48,quickBuffers=new Map(),quickVoices=new Map();
let quick={bpm:[],fx:[]};
try {
  const saved=JSON.parse(localStorage.getItem(quickKey)||'null');
  for(const kind of ['bpm','fx'])if(Array.isArray(saved?.[kind]))quick[kind]=saved[kind];
} catch {}
let quickEdit=null,quickBusy=false;
const quickBlob=id=>'perform-fx:'+id;
const saveQuick=()=>localStorage.setItem(quickKey,JSON.stringify(quick));
const quickSide=(p,kind)=>p.side==='left'||p.side==='right'?p.side:kind==='bpm'?'left':'right';
function quickRows(){
  return ['bpm','fx'].flatMap(kind=>quick[kind].map((p,i)=>({p,i,kind})))
    .sort((a,b)=>quickOrder(a)-quickOrder(b));
}
const quickOrder=({p,i,kind})=>p.gridOrder??((quickSide(p,kind)==='right'?1000:0)+(p.order??i));
function renderQuick(){
  const rows=quickRows();
  for(const [position,selector] of [['left','#quickPadsLeft'],['right','#quickPads']]){
    $(selector).innerHTML=rows.filter(({p})=>(p.position??'right')===position).map(({p,i,kind})=>`<button type="button" data-quick-play="${kind}:${i}" title="กดค้างเพื่อแก้ไขหรือลบ">${kind==='bpm'?`<span class="quick-tempo-value">${escapeHtml(p.bpm)}</span>`:`${escapeHtml(p.name)}<small class="quick-type fx">FX</small>`}</button>`).join('')||'<p>เพิ่มปุ่มจาก ☰</p>';
  }
}
function openQuick(kind,i=-1){
  const p=quick[kind][i],tempo=kind==='bpm';
  quickEdit={kind,i};
  $('#quickForm').reset();
  $('#quickPosition').value=p?.position??(p?'right':quickRows().some(({p})=>p.position==='left')?'right':'left');
  $('#quickTitle').textContent=(p?'แก้ไข ':'เพิ่ม ')+(tempo?'BPM':'FX');
  $('#quickName').value=tempo?'':p?.name||'';
  $('#quickTempo').value=p?.bpm??state.bpm;
  $('#quickVol').value=p?.vol??100;
  $('#quickRepeat').value=p?.repeat==='toggle'?'toggle':'restart';
  $('#quickDelete').hidden=!p;
  for(const [id,visible] of [['quickName',!tempo],['quickTempo',tempo],['quickFile',!tempo],['quickVol',!tempo],['quickRepeat',!tempo]]){
    $('#'+id+'Label').hidden=!visible;
    $('#'+id).disabled=!visible;
  }
  $('#quickError').textContent=p?.file?'ไฟล์เดิม: '+p.file:'';
  $('#quickEdit').showModal();
}
$('#addQuick').onclick=()=>{
  $('#webMenuDialog').close();
  $('#quickChoose').showModal();
};
for(const [id,kind] of [['chooseQuickBpm','bpm'],['chooseQuickFx','fx']]){
  $('#'+id).onclick=()=>{$('#quickChoose').close();openQuick(kind)};
}
$('#quickCancel').onclick=()=>{if(!quickBusy)$('#quickEdit').close()};
$('#quickEdit').addEventListener('cancel',e=>{if(quickBusy)e.preventDefault()});
$('#quickDelete').onclick=async()=>{
  if(quickBusy)return;
  const {kind,i}=quickEdit,p=quick[kind][i];
  quickBusy=true;
  try{
    if(kind==='fx'){await dbPut(quickBlob(p.id),null);stopQuickFx(p.id);quickBuffers.delete(p.id)}
    quick[kind].splice(i,1);saveQuick();renderQuick();$('#quickEdit').close();
  }catch{$('#quickError').textContent='ลบไม่สำเร็จ'}
  finally{quickBusy=false}
};
$('#quickForm').onsubmit=async e=>{
  e.preventDefault();if(quickBusy)return;
  const {kind,i}=quickEdit,old=quick[kind][i],name=$('#quickName').value.trim();
  const rows=quickRows();
  const fail=message=>$('#quickError').textContent=message;
  if(!old&&rows.length>=quickLimit){fail('เพิ่มได้สูงสุด '+quickLimit+' ปุ่ม');return}
  quickBusy=true;
  try{
    let p;
    if(kind==='bpm'){
      const bpm=$('#quickTempo').valueAsNumber;
      if(!Number.isInteger(bpm)||bpm<50||bpm>200){fail('ใส่ BPM 50–200');return}
      p={bpm};
    }else{
      const file=$('#quickFile').files[0],vol=$('#quickVol').valueAsNumber;
      if(!file&&!old){fail('เลือกไฟล์เสียงก่อน');return}
      if(!Number.isFinite(vol)||vol<0||vol>100){fail('ใส่ความดัง 0–100');return}
      if(file&&file.size>20*1024*1024){fail('ไฟล์เสียงต้องไม่เกิน 20 MB');return}
      const id=old?.id||Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
      if(file){
        fail('กำลังอ่านไฟล์เสียง…');
        await initAudio();
        const buffer=await ctx.decodeAudioData(await file.arrayBuffer());
        await dbPut(quickBlob(id),file);
        stopQuickFx(id);
        quickBuffers.set(id,buffer);
      }
      p={id,name:name||old?.name||file.name.replace(/\.[^.]+$/,''),file:file?.name||old.file,vol,repeat:$('#quickRepeat').value==='toggle'?'toggle':'restart'};
    }
    p.gridOrder=old?quickOrder({p:old,i,kind}):1+Math.max(-1,...rows.map(quickOrder));
    p.position=$('#quickPosition').value==='left'?'left':'right';
    if(old)quick[kind][i]=p;else quick[kind].push(p);
    saveQuick();renderQuick();$('#quickEdit').close();
    if(!old&&page!=='perform')setPage('perform');
  }catch{fail('บันทึกไม่ได้ ตรวจสอบไฟล์เสียงหรือพื้นที่จัดเก็บ')}
  finally{quickBusy=false}
};
function stopQuickFx(id){
  const voice=quickVoices.get(id);
  if(!voice)return false;
  quickVoices.delete(id);
  if(voice.source)voice.source.stop();
  return true;
}
async function playQuickFx(p){
  if(stopQuickFx(p.id)&&p.repeat==='toggle')return;
  const voice={source:null};
  quickVoices.set(p.id,voice);
  try{
    await initAudio();
    if(quickVoices.get(p.id)!==voice)return;
    let buffer=quickBuffers.get(p.id);
    if(!buffer){
      const file=await dbGet(quickBlob(p.id));
      if(quickVoices.get(p.id)!==voice)return;
      if(!file)throw Error('missing FX');
      buffer=await ctx.decodeAudioData(await file.arrayBuffer());
      if(quickVoices.get(p.id)!==voice)return;
      quickBuffers.set(p.id,buffer);
    }
    const src=ctx.createBufferSource(),gain=ctx.createGain();
    src.buffer=buffer;gain.gain.value=p.vol/100;
    src.connect(gain).connect(masterGain);
    src.onended=()=>{
      if(quickVoices.get(p.id)===voice)quickVoices.delete(p.id);
      src.disconnect();gain.disconnect();
    };
    try{src.start()}catch(error){src.disconnect();gain.disconnect();throw error}
    voice.source=src;
  }catch{
    if(quickVoices.get(p.id)!==voice)return;
    quickVoices.delete(p.id);
    alert('เล่น FX ไม่ได้ ลองเปิดเสียงหรือเลือกไฟล์ใหม่');
  }
}
let quickPress=null,quickHeld=null;
function cancelQuickHold(){if(quickPress)clearTimeout(quickPress.timer);quickPress=null}
for(const quickGrid of [$('#quickPadsLeft'),$('#quickPads')]){
quickGrid.addEventListener('pointerdown',e=>{
  const button=e.target.closest('[data-quick-play]');
  if(!button||!e.isPrimary||e.button!==0)return;
  cancelQuickHold();quickHeld=null;
  const press={button,id:e.pointerId,x:e.clientX,y:e.clientY};
  quickPress=press;
  press.timer=setTimeout(()=>{
    if(quickPress!==press)return;
    quickHeld=button;
    cancelQuickHold();
    const [kind,index]=button.dataset.quickPlay.split(':');
    openQuick(kind,+index);
  },550);
});
quickGrid.addEventListener('pointermove',e=>{
  if(quickPress?.id===e.pointerId&&Math.hypot(e.clientX-quickPress.x,e.clientY-quickPress.y)>10)cancelQuickHold();
});
for(const event of ['pointerup','pointercancel','pointerleave'])quickGrid.addEventListener(event,cancelQuickHold);
quickGrid.addEventListener('contextmenu',e=>{if(e.target.closest('[data-quick-play]'))e.preventDefault()});
quickGrid.addEventListener('keydown',e=>{
  const button=e.target.closest('[data-quick-play]');
  if(!button||e.key!=='F2')return;
  e.preventDefault();
  const [kind,index]=button.dataset.quickPlay.split(':');openQuick(kind,+index);
});
quickGrid.addEventListener('click',e=>{
  const button=e.target.closest('[data-quick-play]');
  if(!button)return;
  if(quickHeld===button&&e.detail!==0){quickHeld=null;return}
  const [kind,index]=button.dataset.quickPlay.split(':');
  const p=quick[kind][+index];if(!p)return;
  if(kind==='bpm'){state.bpm=p.bpm;renderTop();persist()}
  else playQuickFx(p);
});
}
renderQuick();
let controllerOnline=false;
function updateControllerStatus(){
  const label=$('#wifiStatus');
  label.dataset.online=String(controllerOnline);
  label.textContent=!controllerOnline?'รอ Bluetooth MIDI':ctx?.state!=='running'?'แตะเปิดเสียง':!soundsLoaded?'กำลังโหลดเสียง…':'พร้อมรับ MIDI';
}
function deckTime(seconds){
  const whole=Math.floor(Number.isFinite(seconds)?seconds:0);
  return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;
}
function audioPeaks(buffer){
  const count=Math.max(1,Math.min(buffer.length,48000,Math.ceil(buffer.duration*120)));
  const peaks=new Float32Array(count);
  const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,index)=>buffer.getChannelData(index));
  for(let i=0;i<count;i++){
    const start=Math.floor(i*buffer.length/count),end=Math.floor((i+1)*buffer.length/count);
    const stride=Math.max(1,Math.floor((end-start)/48));
    let peak=0;
    for(const samples of channels){
      for(let j=start;j<end;j+=stride)peak=Math.max(peak,Math.abs(samples[j]));
    }
    peaks[i]=peak;
  }
  return peaks;
}
function paintMdWave(canvas,peaks,position,duration,color,detail=false,marks=[]){
  const ratio=Math.min(2,window.devicePixelRatio||1);
  const w=Math.round(canvas.clientWidth*ratio),h=Math.round(canvas.clientHeight*ratio);
  if(!w||!h)return;
  if(canvas.width!==w)canvas.width=w;
  if(canvas.height!==h)canvas.height=h;
  const g=canvas.getContext('2d');
  if(!g)return;
  g.clearRect(0,0,w,h);
  const size=detail?h:w,mid=(detail?w:h)/2;
  g.lineWidth=ratio;
  g.strokeStyle='#253540';
  g.beginPath();
  if(detail){g.moveTo(mid,0);g.lineTo(mid,h)}
  else{g.moveTo(0,mid);g.lineTo(w,mid)}
  g.stroke();
  if(detail){
    const first=Math.max(0,Math.ceil(position-6));
    for(let second=first;second<=Math.min(duration,position+6);second++){
      const y=(.5+(second-position)/12)*h;
      g.strokeStyle=second%4===0?'#d49e38':'#475969';
      g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();
    }
  }
  if(peaks&&duration>0){
    const stride=Math.max(1,Math.floor(ratio));
    const gradient=detail?g.createLinearGradient(0,0,w,0):g.createLinearGradient(0,0,0,h);
    gradient.addColorStop(0,color);
    gradient.addColorStop(.5,detail?'#d5fff0':color);
    gradient.addColorStop(1,color);
    const points=[];
    for(let pixel=0;pixel<size;pixel+=stride){
      const from=detail?(position+(pixel/size-.5)*12)/duration:pixel/size;
      if(from<0||from>=1)continue;
      const to=from+stride/size*(detail?12/duration:1);
      const start=Math.floor(from*peaks.length),end=Math.min(peaks.length,Math.ceil(to*peaks.length));
      let peak=0;
      for(let i=start;i<end;i++)peak=Math.max(peak,peaks[i]);
      points.push([pixel,Math.pow(Math.min(1,peak),.55)*mid*.94]);
    }
    if(points.length){
      const edge=(pixel,amplitude)=>detail?g.lineTo(mid+amplitude,pixel):g.lineTo(pixel,mid+amplitude);
      g.fillStyle=gradient;
      g.beginPath();
      if(detail)g.moveTo(mid,points[0][0]);else g.moveTo(points[0][0],mid);
      for(const [pixel,amp] of points)edge(pixel,amp);
      for(let i=points.length-1;i>=0;i--)edge(points[i][0],-points[i][1]);
      g.closePath();g.fill();
    }
  }
  if(duration>0){
    g.fillStyle='#b6f1ff';
    for(const mark of marks){
      if(mark===null)continue;
      const location=detail?(.5+(mark-position)/12)*h:(mark/duration)*w;
      if(location<0||location>size)continue;
      const edge=clamp(location,ratio,size-ratio);
      if(detail)g.fillRect(0,edge-ratio,w,ratio);
      else g.fillRect(edge-ratio,0,ratio*2,h);
    }
    if(detail){
      g.strokeStyle='#ff666c';
      g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke();
    }
  }
}
const mdCross=$('#mdCrossfader');
const mdDecks=$$('.md-deck').map((card,index)=>{
  const file=card.querySelector('.md-load input');
  const title=card.querySelector('.md-name'),status=card.querySelector('.md-status');
  const play=card.querySelector('.md-play'),cue=card.querySelector('.md-cue');
  const seek=card.querySelector('.md-wave-seek input'),time=card.querySelector('.md-time');
  const overview=card.querySelector('.md-wave-overview');
  const playhead=card.querySelector('.md-overview-playhead');
  const detail=$(`[data-wave-deck="${card.dataset.deck}"] .md-wave-detail`);
  const detailArea=detail.parentElement;
  const color=index===0?'#58e4c1':'#ffd471';
  const volume=card.querySelector('.md-volume input');
  let buffer=null,gain=null,peaks=null,drag=null,frame=0,lastPaint=0,overviewDirty=true;
  let offset=0,voice=null,availableAt=0,loadVersion=0,timeLabel='';
  const duration=()=>buffer?.duration||0;
  const position=()=>voice?Math.min(duration(),voice.offset+Math.max(0,ctx.currentTime-voice.start)):offset;
  const fade=.006;
  function retireVoice(){
    if(!voice)return;
    const {source,envelope,start}=voice;
    voice=null;
    const now=ctx.currentTime;
    if(now<=start||ctx.state!=='running'){
      source.stop(now);
      return;
    }
    const level=clamp((now-start)/fade,0,1);
    availableAt=now+fade;
    envelope.gain.cancelScheduledValues(now);
    envelope.gain.setValueAtTime(level,now);
    envelope.gain.linearRampToValueAtTime(0,availableAt);
    source.stop(availableAt);
  }
  function pauseDeck(){
    offset=position();
    retireVoice();
    updatePlay();
  }
  function seekDeck(next,playNow=false){
    offset=clamp(next,0,duration());
    if(playNow||voice)startDeck(offset);
    else{updateTime();renderWaves()}
  }
  const marks=Array(8).fill(null);
  const cueGrid=card.querySelector('.md-hotcues');
  cueGrid.innerHTML=marks.map((_,i)=>`<button type="button" data-mark="${i}" disabled><span>+</span><small>${i+1}</small></button>`).join('');
  const cueButtons=[...cueGrid.querySelectorAll('button')];
  let cueHold=null,heldCue=null;
  const canMark=()=>duration()>0;
  const renderCues=()=>{
    cueButtons.forEach((button,i)=>{
      const mark=marks[i];
      button.disabled=!canMark();
      button.toggleAttribute('data-marked',mark!==null);
      button.firstElementChild.textContent=mark===null?'+':String(i+1);
      button.lastElementChild.textContent=mark===null?String(i+1):deckTime(mark);
      button.setAttribute('aria-label',mark===null?`มาร์กจุด ${i+1}`:`ไปยังจุด ${i+1} เวลา ${deckTime(mark)}`);
    });
  };
  const cancelCueHold=()=>{
    if(cueHold)clearTimeout(cueHold.timer);
    cueHold=null;
  };
  const renderWaves=()=>{
    const length=duration(),elapsed=position();
    if(overviewDirty&&overview.clientWidth&&overview.clientHeight){
      paintMdWave(overview,peaks,0,length,color,false,marks);
      overviewDirty=false;
    }
    playhead.hidden=length<=0;
    if(length>0)playhead.style.left=`clamp(0px,${elapsed/length*100}%,calc(100% - 2px))`;
    paintMdWave(detail,peaks,elapsed,length,color,true,marks);
  };
  const animateWaves=now=>{
    frame=0;
    if(!voice)return;
    if(now-lastPaint>=33){updateTime();renderWaves();lastPaint=now}
    frame=requestAnimationFrame(animateWaves);
  };
  const waveSize=new ResizeObserver(()=>{overviewDirty=true;renderWaves()});
  waveSize.observe(overview);
  waveSize.observe(detail);
  async function loadTrack(song,version){
    try{
      const decoded=await prepareAudio().decodeAudioData(await song.arrayBuffer());
      if(loadVersion!==version)return;
      peaks=audioPeaks(decoded);
      buffer=decoded;
      overviewDirty=true;
      status.textContent='';
      play.disabled=cue.disabled=false;
      updateTime();
      renderCues();
      renderWaves();
    }catch{
      if(loadVersion===version)status.textContent='อ่านไฟล์เสียงไม่ได้';
    }
  }
  const updateGain=()=>{
    if(!gain)return;
    const cross=Number(mdCross.value)/100;
    const blend=index===0?1-Math.max(0,cross):1+Math.min(0,cross);
    gain.gain.setTargetAtTime(Number(volume.value)/100*blend,ctx.currentTime,.01);
  };
  const updateTime=()=>{
    const length=duration(),elapsed=position();
    seek.disabled=!length;
    seek.value=length?Math.round(elapsed/length*1000):0;
    const label=`${deckTime(elapsed)} / ${deckTime(length)}`;
    if(timeLabel!==label){timeLabel=label;time.textContent=label}
  };
  const updatePlay=()=>{
    card.classList.toggle('playing',!!voice);
    play.textContent=voice?'PAUSE':'PLAY';
    if(voice&&!frame)frame=requestAnimationFrame(animateWaves);
    if(!voice){updateTime();renderWaves()}
  };
  cueGrid.addEventListener('pointerdown',event=>{
    const button=event.target.closest('[data-mark]');
    if(!button||!event.isPrimary||event.button!==0)return;
    heldCue=null;
    cancelCueHold();
    const i=Number(button.dataset.mark);
    if(!canMark()||marks[i]===null)return;
    const press={id:event.pointerId,x:event.clientX,y:event.clientY};
    cueHold=press;
    press.timer=setTimeout(()=>{
      if(cueHold!==press)return;
      heldCue=button;
      marks[i]=null;
      overviewDirty=true;
      cancelCueHold();
      renderCues();
      renderWaves();
    },550);
  });
  cueGrid.addEventListener('pointermove',event=>{
    if(cueHold?.id===event.pointerId&&Math.hypot(event.clientX-cueHold.x,event.clientY-cueHold.y)>10)cancelCueHold();
  });
  for(const name of ['pointerup','pointercancel','pointerleave'])cueGrid.addEventListener(name,cancelCueHold);
  cueGrid.addEventListener('contextmenu',event=>event.preventDefault());
  cueGrid.addEventListener('click',event=>{
    const button=event.target.closest('[data-mark]');
    if(!button||!canMark())return;
    if(button===heldCue){heldCue=null;return}
    const i=Number(button.dataset.mark);
    if(marks[i]===null){
      marks[i]=position();
      overviewDirty=true;
    }else{
      seekDeck(marks[i],true);
    }
    updateTime();
    renderCues();
    renderWaves();
  });
  file.addEventListener('change',()=>{
    const song=file.files[0];
    if(!song)return;
    pauseDeck();
    const version=++loadVersion;
    buffer=null;peaks=null;offset=0;drag=null;
    title.textContent=title.title=song.name;
    status.textContent='กำลังโหลดเพลง…';
    play.disabled=cue.disabled=true;
    file.value='';
    cancelCueHold();heldCue=null;marks.fill(null);overviewDirty=true;
    updateTime();renderCues();renderWaves();
    void loadTrack(song,version);
  });
  function startDeck(next=offset){
    if(!buffer)return;
    status.textContent='';
    try{
      const resume=initAudio();
      if(!gain){gain=ctx.createGain();gain.connect(masterGain)}
      updateGain();
      retireVoice();
      offset=next>=duration()?0:Math.max(0,next);
      const source=ctx.createBufferSource(),envelope=ctx.createGain();
      source.buffer=buffer;
      source.connect(envelope).connect(gain);
      const start=Math.max(ctx.currentTime,availableAt);
      const current={source,envelope,start,offset};
      envelope.gain.setValueAtTime(0,start);
      envelope.gain.linearRampToValueAtTime(1,start+fade);
      source.onended=()=>{
        source.disconnect();envelope.disconnect();
        if(voice!==current)return;
        voice=null;offset=duration();updatePlay();
      };
      source.start(start,offset);
      voice=current;
      updatePlay();
      resume.catch(()=>{
        if(voice!==current)return;
        pauseDeck();status.textContent='เปิดเสียงไม่ได้';
      });
    }catch{status.textContent='เปิดเสียงไม่ได้';updatePlay()}
  }
  play.onclick=()=>{if(voice)pauseDeck();else startDeck()};
  cue.onclick=()=>{if(buffer)seekDeck(0)};
  seek.addEventListener('input',()=>{if(buffer)seekDeck(Number(seek.value)/1000*duration())});
  detailArea.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0||!buffer)return;
    drag={id:event.pointerId,startY:event.clientY,startTime:position(),resume:!!voice};
    if(voice)pauseDeck();
    detailArea.setPointerCapture(event.pointerId);
  });
  detailArea.addEventListener('pointermove',event=>{
    if(drag?.id!==event.pointerId)return;
    const delta=(event.clientY-drag.startY)*12/Math.max(1,detailArea.clientHeight);
    seekDeck(drag.startTime-delta);
  });
  for(const eventName of ['pointerup','pointercancel','lostpointercapture']){
    detailArea.addEventListener(eventName,event=>{
      if(drag?.id!==event.pointerId)return;
      const resume=drag.resume;
      drag=null;
      if(resume)startDeck();
    });
  }
  volume.addEventListener('input',updateGain);
  return {updateGain,pause:pauseDeck};
});
mdCross.addEventListener('input',()=>mdDecks.forEach(deck=>deck.updateGain()));
setPage(page);soundsReady=loadSounds().catch(e=>{console.error(e);soundsLoaded=true;updateAudioStatus()});
updateControllerStatus();
void connectMidi();
