#include <cstdio>
#include "../audio/apu.cpp"
int main() {
  audio_reset(48000);audio_lengths(15);
  audio_write(0x4000,0x82);audio_write(0x4002,253);audio_write(0x4003,0);
  audio_write(0x4004,0x5c);audio_write(0x4006,160);audio_write(0x4007,0);
  audio_write(0x4008,0x81);audio_write(0x400a,200);audio_write(0x400b,0);
  audio_write(0x400c,0x18);audio_write(0x400e,7);audio_write(0x400f,0);
  for(int i=0;i<120;i++){
    audio_quarter();if(i%2==0)audio_half();audio_dmc((i*7)&127);audio_advance(7457);
    while(audio_available()){float value=audio_pop();std::fwrite(&value,sizeof value,1,stdout);}
  }
}
