# VajNES-JS

**VajNES-JS** is a work-in-progress NES emulator written in **pure vanilla JavaScript**.  
Started in **2023** during a coding boot-camp and still actively evolving.

**249 commits** so far — a *real* README was long overdue 😄

---

## ⚠️ Current Status

### Broken
- RF static audio on some browsers  
- Adjustable background images / GIFs  
  *(Broken by the disassembler code taking precedence — not yet fixed)*

### General State
- **Buggy as of now**
- **Mach Rider** seems playable
- **Kung Fu** also playable
- Other **Mapper 0** games load with glitches
- Expect unknown bugs

---

## 🗺️ Mapper Support
- **WIP MMC1 support**
  - *The Legend of Zelda* loads to the **intro screen**

---

## 🧪 Accuracy Tests

**Coin Test Results (250 commits)**  
- NMI timing **fails** here  
- Passes the **older Blarg test**

![Accuracy Test Results](https://drive.google.com/uc?id=15ISSq-_7imfwp82HW2acy9QNE_I858JA)

---

## 🛠️ Tools & Debugging Features

### Disassembler
![Disassembler](https://drive.google.com/uc?id=1SFen79_7cNnY-1gxcbm0vjhE5Qd-WpP6)

### CSV Export of Disassembler Output
![CSV Export](https://drive.google.com/uc?id=10YlsWkmtExwkyrs32jVZuzwlG9glcKI-)

### Breakpoints (Half-Ass Implementation 😅)
![Breakpoints](https://drive.google.com/uc?id=1Y7ZEus8lxquOyhMxZr8Vg8N1kZjv3ydo)

---

## 📊 State & Memory Inspection

### State Dumper
- Opens in a **new tab**
- Quick navigation buttons
- **Red bytes** indicate values changed since the last dump

![State Dumper](https://drive.google.com/uc?id=13Ghu7yvCJ5mzVELbG9OTj7Sgi--S-U_H)

### Live State Editing
- Modify **all state values live**
- Example: give yourself **infinite lives** if you know the RAM offset

![Live State Editing](https://drive.google.com/uc?id=1M1WR1SeEYMyR54dU_Ac2J96yBk9EXESF)

---

## 🎮 Graphics & Rendering

### Pixel Scaling
- True NES pixel output

![Pixel Scaling](https://drive.google.com/uc?id=1DtnqpJAwWyc3e2fYlv75Hf44p0NNVTbD)

### Scaling Options
![Scaling](https://drive.google.com/uc?id=1a3iN-BwAtitu3UR4sVqrR8M-uTld9vdK)

### Selectable Palettes (Applied Live)
![Palettes](https://drive.google.com/uc?id=1a5ciRveZ8BSSZ3WgYKqa_xrsd-npgb3s)

### Tile Viewer
![Tile Viewer](https://drive.google.com/uc?id=1IRpRlgj-7AHbJIwfSpYjySC0xv7HpH7J)

---

## 📺 Retro Effects (retroFx)

Scanline & aperture-grill tuning  
Composite blur slider for those who don’t like razor-sharp pixels

![retroFx 1](https://drive.google.com/uc?id=1iiUyYpKR0HDIVINo9z0d3ebUYCFwM4MR)
![retroFx 2](https://drive.google.com/uc?id=1yGrGmt0ato1NjaG3wiNwnguUw-yG5Dua)
![retroFx 3](https://drive.google.com/uc?id=1pmQdWTdsOlqoRvsGnFmukXG8zUqAbpN8)
![retroFx 4](https://drive.google.com/uc?id=1HZQ362I-NLB--3pcpeSfp676SqveEtwy)

---

## 📦 ROM Handling

### ROM Header Parsing
- Mapper-aware loading

![ROM Header Parsing](https://drive.google.com/uc?id=1eFm47trnS2NXQAKxcYJUAvVWr2FyQABd)

---

## 📡 CRT Authenticity

### RF Static (with Audio)
- Authentic **pre-console power-on CRT feel**

![RF Static](https://drive.google.com/uc?id=1O6DlyhariDeNITpZm5CoUS-vIudeNBKX)

---

## 🧭 User Interface

### UI with Quick Jumps
- Fast access to important memory offsets

![UI](https://drive.google.com/uc?id=1JacEm0X5lHeVE5dQ_gaTSPpVgoeT-OtU)

---

## 🚧 Disclaimer

This project is **experimental**, **educational**, and **very much a work in progress**.  
Accuracy, performance, and compatibility are actively being improved.
