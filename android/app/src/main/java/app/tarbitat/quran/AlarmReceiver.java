package app.tarbitat.quran;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

public class AlarmReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent in) {
    Intent s = new Intent(ctx, AlarmService.class);
    s.putExtras(in);
    ContextCompat.startForegroundService(ctx, s);
  }
}
