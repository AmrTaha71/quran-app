package app.tarbitat.quran;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * Exact alarms that play on the ALARM audio stream, so the adhan / Fajr alarm
 * ring even when the phone is on silent / vibrate (not through Do Not Disturb
 * unless the user allows alarms there). JS: registerPlugin('AlarmSound').
 */
@CapacitorPlugin(name = "AlarmSound")
public class AlarmSoundPlugin extends Plugin {
  static final String PREFS = "alarm_sound";

  @PluginMethod
  public void schedule(PluginCall call) {
    try {
      Context c = getContext();
      JSArray items = call.getArray("items");
      AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
      SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      for (int i = 0; i < items.length(); i++) {
        JSONObject o = items.getJSONObject(i);
        int id = o.getInt("id");
        Intent in = new Intent(c, AlarmReceiver.class);
        in.putExtra("sound", o.optString("sound", ""));
        in.putExtra("title", o.optString("title", ""));
        in.putExtra("body", o.optString("body", ""));
        in.putExtra("type", o.optString("type", "adhan"));
        PendingIntent pi = PendingIntent.getBroadcast(c, id, in, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // setAlarmClock: exact, Doze-exempt, shows the alarm icon.
        PendingIntent show = PendingIntent.getActivity(c, 0, c.getPackageManager().getLaunchIntentForPackage(c.getPackageName()), PendingIntent.FLAG_IMMUTABLE);
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(o.getLong("at"), show), pi);
      }
      StringBuilder ids = new StringBuilder(sp.getString("ids", ""));
      for (int i = 0; i < items.length(); i++) ids.append(items.getJSONObject(i).getInt("id")).append(',');
      sp.edit().putString("ids", ids.toString()).apply();
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  @PluginMethod
  public void cancelAll(PluginCall call) {
    try {
      Context c = getContext();
      AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
      SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      for (String s : sp.getString("ids", "").split(",")) {
        if (s.isEmpty()) continue;
        PendingIntent pi = PendingIntent.getBroadcast(c, Integer.parseInt(s), new Intent(c, AlarmReceiver.class), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (pi != null) { am.cancel(pi); pi.cancel(); }
      }
      sp.edit().putString("ids", "").apply();
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  /** Stop any sound that is playing now (user solved the challenges). */
  @PluginMethod
  public void stop(PluginCall call) {
    Context c = getContext();
    c.stopService(new Intent(c, AlarmService.class));
    call.resolve();
  }

  /** True once if a Fajr alarm fired since the last call (JS then shows the questions). */
  @PluginMethod
  public void takePendingFajr(PluginCall call) {
    SharedPreferences sp = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    boolean p = sp.getBoolean("pending_fajr", false);
    sp.edit().putBoolean("pending_fajr", false).apply();
    JSObject r = new JSObject();
    r.put("pending", p);
    call.resolve(r);
  }
}
