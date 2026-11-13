package app.tarbitat.quran;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(AlarmSoundPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
