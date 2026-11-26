package app.tarbitat.quran;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Item 9.4: a reboot wipes every AlarmManager alarm. Re-arm the adhan /
 * Fajr alarms saved by AlarmSoundPlugin.schedule() — only the ones still in
 * the future — so they survive a phone restart without opening the app.
 * (The app itself still reschedules the next days whenever it opens.)
 */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    String action = intent == null ? null : intent.getAction();
    if (!Intent.ACTION_BOOT_COMPLETED.equals(action)) return;
    try {
      SharedPreferences sp = ctx.getSharedPreferences(AlarmSoundPlugin.PREFS, Context.MODE_PRIVATE);
      JSONArray saved = new JSONArray(sp.getString("items", "[]"));
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      long now = System.currentTimeMillis();
      JSONArray kept = new JSONArray();
      for (int i = 0; i < saved.length(); i++) {
        JSONObject o = saved.getJSONObject(i);
        if (o.optLong("at", 0) <= now) continue;
        try {
          AlarmSoundPlugin.scheduleOne(ctx, am, o);
          kept.put(o);
        } catch (Exception ignored) { /* one bad item must not block the rest */ }
      }
      sp.edit().putString("items", kept.toString()).apply();
    } catch (Exception ignored) { /* nothing saved yet */ }
  }
}
