package app.tarbitat.quran;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/** Foreground service that plays the adhan / alarm on the ALARM stream. */
public class AlarmService extends Service {
  private static final String CH = "alarm_native";
  private MediaPlayer mp;
  private final Handler h = new Handler();

  @Override public IBinder onBind(Intent i) { return null; }

  @Override
  public int onStartCommand(Intent in, int flags, int startId) {
    String type = in != null ? in.getStringExtra("type") : "adhan";
    boolean fajr = "fajr-alarm".equals(type);
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel ch = new NotificationChannel(CH, "الأذان والمنبه", NotificationManager.IMPORTANCE_HIGH);
      ch.setSound(null, null);
      nm.createNotificationChannel(ch);
    }
    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification n = new NotificationCompat.Builder(this, CH)
        .setSmallIcon(R.drawable.ic_stat_icon)
        .setContentTitle(in != null ? in.getStringExtra("title") : "")
        .setContentText(in != null ? in.getStringExtra("body") : "")
        .setContentIntent(pi).setFullScreenIntent(fajr ? pi : null, fajr)
        .setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(NotificationCompat.PRIORITY_MAX)
        .setOngoing(true).build();
    if (Build.VERSION.SDK_INT >= 29) startForeground(77, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    else startForeground(77, n);

    if (fajr) {
      SharedPreferences sp = getSharedPreferences(AlarmSoundPlugin.PREFS, Context.MODE_PRIVATE);
      sp.edit().putBoolean("pending_fajr", true).apply();
    }
    play(in != null ? in.getStringExtra("sound") : "", fajr);
    return START_NOT_STICKY;
  }

  private void play(String sound, boolean loop) {
    try {
      if (mp != null) mp.release();
      mp = new MediaPlayer();
      mp.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
      int res = (sound == null || sound.isEmpty()) ? 0 : getResources().getIdentifier(sound, "raw", getPackageName());
      if (res != 0) {
        AssetFileDescriptor fd = getResources().openRawResourceFd(res);
        mp.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
        fd.close();
      } else {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        mp.setDataSource(this, u);
      }
      mp.setLooping(loop);
      mp.setOnCompletionListener(m -> stopSelf());
      mp.prepare();
      mp.start();
      // Fajr alarm rings up to 60 s per chain step, then the next step takes over.
      if (loop) h.postDelayed(this::stopSelf, 55_000);
    } catch (Exception e) {
      stopSelf();
    }
  }

  @Override
  public void onDestroy() {
    h.removeCallbacksAndMessages(null);
    if (mp != null) { try { mp.stop(); } catch (Exception ignored) {} mp.release(); mp = null; }
    stopForeground(true);
    super.onDestroy();
  }
}
