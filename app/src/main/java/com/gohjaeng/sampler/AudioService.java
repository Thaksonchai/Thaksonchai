package com.gohjaeng.sampler;

import android.app.*;
import android.content.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import java.util.*;

/** Media playback is owned by this foreground service, never by WebView JavaScript. */
public final class AudioService extends Service {
    public static final String ACTION="com.gohjaeng.sampler.AUDIO";
    public static final String STATE="com.gohjaeng.sampler.STATE";
    private static final String CHANNEL="gj_audio";
    private final ArrayList<MediaPlayer> voices=new ArrayList<>();
    private MediaPlayer md;
    private boolean mdPlaying=false;
    private float master=1f;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private boolean resumeOnFocus=false;
    private final AudioManager.OnAudioFocusChangeListener focusListener=change -> {
        if(change==AudioManager.AUDIOFOCUS_LOSS || change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT){
            resumeOnFocus=mdPlaying;
            if(md!=null && mdPlaying){md.pause();mdPlaying=false;sendState();}
        }else if(change==AudioManager.AUDIOFOCUS_GAIN && resumeOnFocus){
            resumeOnFocus=false;
            if(md!=null){md.start();mdPlaying=true;sendState();}
        }
    };
    @Override public void onCreate(){super.onCreate();audioManager=(AudioManager)getSystemService(AUDIO_SERVICE); createChannel();}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        startForeground(11,notification());
        if(intent==null)return START_STICKY;
        String cmd=intent.getStringExtra("cmd");
        if(cmd==null)return START_STICKY;
        try {
            switch(cmd){
                case "mdPlay": {String uri=intent.getStringExtra("uri");if(uri!=null)playMd(Uri.parse(uri));break;}
                case "mdToggle":toggleMd();break;
                case "mdStop":stopMd();break;
                case "mdLoop":if(md!=null)md.setLooping(intent.getBooleanExtra("loop",true));break;
                case "pad": {String uri=intent.getStringExtra("uri");if(uri!=null)playPad(Uri.parse(uri));break;}
                case "volume":master=Math.max(0,Math.min(1,intent.getFloatExtra("volume",1)));applyVolume();break;
                case "stopAll":stopMd();for(MediaPlayer p:new ArrayList<>(voices))releaseVoice(p);break;
            }
        } catch(Exception e){broadcastError(e.getMessage());}
        sendState();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(11,notification());
        return START_STICKY;
    }
    private void playMd(Uri uri) throws Exception {
        ensureFocus();
        if(md!=null){md.release();md=null;}
        MediaPlayer p=new MediaPlayer();md=p;
        p.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
        p.setDataSource(this,uri);p.setLooping(true);p.prepare();p.setVolume(master,master);
        p.setOnCompletionListener(done->{mdPlaying=false;sendState();});
        p.start();mdPlaying=true;
    }
    private void toggleMd(){if(md==null)return;if(mdPlaying){md.pause();mdPlaying=false;}else{ensureFocus();md.start();mdPlaying=true;}}
    private void stopMd(){if(md!=null){md.stop();md.release();md=null;}mdPlaying=false;resumeOnFocus=false;}
    private void playPad(Uri uri) throws Exception {
        ensureFocus();
        // Overlapping samples; cap simultaneous one-shots to prevent unbounded memory use.
        if(voices.size()>=16)releaseVoice(voices.get(0));
        MediaPlayer p=new MediaPlayer();
        p.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
        p.setDataSource(this,uri);p.prepare();p.setVolume(master,master);
        p.setOnCompletionListener(this::releaseVoice);
        p.setOnErrorListener((bad,what,extra)->{releaseVoice(bad);return true;});
        voices.add(p);p.start();
    }
    private void releaseVoice(MediaPlayer p){voices.remove(p);try{p.release();}catch(Exception ignored){}}
    private void applyVolume(){if(md!=null)md.setVolume(master,master);for(MediaPlayer p:voices)p.setVolume(master,master);}
    private void ensureFocus(){
        if(Build.VERSION.SDK_INT>=26){
            if(focusRequest==null)focusRequest=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setOnAudioFocusChangeListener(focusListener).build();
            audioManager.requestAudioFocus(focusRequest);
        }
    }
    private void createChannel(){NotificationChannel c=new NotificationChannel(CHANNEL,"Sampler Audio",NotificationManager.IMPORTANCE_LOW);c.setDescription("Playing sampler audio in background");getSystemService(NotificationManager.class).createNotificationChannel(c);}
    private Notification notification(){
        Intent launch=new Intent(this,MainActivity.class);
        PendingIntent open=PendingIntent.getActivity(this,1,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Intent stop=new Intent(this,AudioService.class).putExtra("cmd","stopAll");
        PendingIntent stopPi=PendingIntent.getService(this,2,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Goh-Jaeng Sampler")
            .setContentText(mdPlaying?"MD playing • background audio":"Sampler ready")
            .setContentIntent(open).setOngoing(true)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause,"Stop all",stopPi).build())
            .build();
    }
    private void sendState(){Intent i=new Intent(STATE);i.setPackage(getPackageName());i.putExtra("playing",mdPlaying);sendBroadcast(i);}
    private void broadcastError(String msg){Intent i=new Intent(STATE);i.setPackage(getPackageName());i.putExtra("error",msg==null?"Audio error":msg);sendBroadcast(i);}
    @Override public void onDestroy(){stopMd();for(MediaPlayer p:new ArrayList<>(voices))releaseVoice(p);if(focusRequest!=null)audioManager.abandonAudioFocusRequest(focusRequest);super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}
