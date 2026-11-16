package com.gohjaeng.sampler;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.view.*;
import android.widget.Toast;
import org.json.*;

public final class MainActivity extends Activity {
    private WebView web;
    private static final int PICK_MD=100;private static final int PICK_PAD=101;
    private int selectedPad=-1;
    private final BroadcastReceiver receiver=new BroadcastReceiver(){@Override public void onReceive(Context ctx,Intent intent){
        if(intent.hasExtra("error"))callback("window.GJNative.onError("+JSONObject.quote(intent.getStringExtra("error"))+ ")");
        if(intent.hasExtra("playing"))callback("window.GJNative.onPlaying("+intent.getBooleanExtra("playing",false)+")");
    }};
    @Override public void onCreate(Bundle b){super.onCreate(b);
        getWindow().setStatusBarColor(0xff151316);getWindow().setNavigationBarColor(0xff151316);
        web=new WebView(this);setContentView(web);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(),"AndroidBridge");
        web.setWebViewClient(new WebViewClient());web.loadUrl("file:///android_asset/index.html");
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},5);}
    }
    private void callback(String js){runOnUiThread(()->{if(web!=null)web.evaluateJavascript(js,null);});}
    private void command(String action,String uri){Intent i=new Intent(this,AudioService.class).putExtra("cmd",action);if(uri!=null)i.putExtra("uri",uri);startForegroundService(i);}
    private void pick(int type){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.setType("audio/*");i.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,type);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(result!=RESULT_OK || data==null || data.getData()==null)return;
        Uri u=data.getData();
        try{getContentResolver().takePersistableUriPermission(u,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){}
        String value=u.toString();String name=u.getLastPathSegment();if(name==null)name="Audio file";
        try(android.database.Cursor c=getContentResolver().query(u,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){
            if(c!=null && c.moveToFirst())name=c.getString(0);
        }catch(Exception ignored){}
        if(request==PICK_MD){getPreferences(0).edit().putString("md_uri",value).putString("md_name",name).apply();
            callback("window.GJNative.fileChosen('md',-1,"+JSONObject.quote(name)+")");
        }else if(request==PICK_PAD && selectedPad>=0){int p=selectedPad;getPreferences(0).edit().putString("p"+p+"_uri",value).putString("p"+p+"_name",name).apply();
            callback("window.GJNative.fileChosen('pad',"+p+","+JSONObject.quote(name)+")");
        }
    }
    @Override protected void onStart(){super.onStart();IntentFilter f=new IntentFilter(AudioService.STATE);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(receiver,f,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(receiver,f);
    }
    @Override protected void onStop(){unregisterReceiver(receiver);super.onStop();}
    @Override protected void onDestroy(){if(web!=null){web.destroy();web=null;}super.onDestroy();}
    final class Bridge {
        @JavascriptInterface public String state(){JSONObject o=new JSONObject();try{
            android.content.SharedPreferences p=getPreferences(0);
            o.put("md",p.getString("md_name","เลือกไฟล์ MD"));
            JSONArray pads=new JSONArray();for(int j=0;j<8;j++)pads.put(p.getString("p"+j+"_name","PAD "+(j+1)));
            o.put("pads",pads);o.put("bpm",p.getInt("bpm",120));o.put("volume",p.getInt("volume",100));
        }catch(Exception ignored){}return o.toString();}
        @JavascriptInterface public void selectMd(){runOnUiThread(()->pick(PICK_MD));}
        @JavascriptInterface public void selectPad(int n){if(n<0||n>=8)return;runOnUiThread(()->{selectedPad=n;pick(PICK_PAD);});}
        @JavascriptInterface public void playMd(){runOnUiThread(()->{String u=getPreferences(0).getString("md_uri",null);if(u==null){pick(PICK_MD);return;}command("mdPlay",u);});}
        @JavascriptInterface public void toggleMd(){runOnUiThread(()->command("mdToggle",null));}
        @JavascriptInterface public void stopMd(){runOnUiThread(()->command("mdStop",null));}
        @JavascriptInterface public void playPad(int n){if(n<0||n>=8)return;runOnUiThread(()->{String u=getPreferences(0).getString("p"+n+"_uri",null);if(u==null){selectedPad=n;pick(PICK_PAD);return;}command("pad",u);});}
        @JavascriptInterface public void volume(int n){n=Math.max(0,Math.min(100,n));getPreferences(0).edit().putInt("volume",n).apply();Intent i=new Intent(MainActivity.this,AudioService.class).putExtra("cmd","volume").putExtra("volume",n/100f);startForegroundService(i);}
        @JavascriptInterface public void bpm(int n){getPreferences(0).edit().putInt("bpm",Math.max(40,Math.min(260,n))).apply();}
        @JavascriptInterface public void stopAll(){runOnUiThread(()->command("stopAll",null));}
    }
}
