// run from console after loading test/ dummy rom, set test to true in debug.js

function runBench(iterations) {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) step();
  return performance.now() - t0;
}

function stats(arr) {
  arr.sort((a,b)=>a-b);
  const sum = arr.reduce((a,b)=>a+b, 0);
  const mean = sum/arr.length;
  const median = arr.length%2===1
    ? arr[(arr.length-1)/2]
    : (arr[arr.length/2-1] + arr[arr.length/2]) / 2;
  return { min: arr[0], max: arr[arr.length-1], mean, median };
}

function benchmarkHarness(runs=5) {
  console.log("=== Benchmarking CPU core ===");

  ["10k","100k"].forEach(label => {
    const iters = label === "10k" ? 10_000 : 100_000;
    const samples = [];

    // Collect runs, discarding the first (JIT warm-up)
    for (let r = 0; r < runs; r++) {
      // (Re-initialize CPU state here if needed)
      const time = runBench(iters);
      samples.push(time);
    }
    // drop the first sample
    samples.shift();
    const { min, max, mean, median } = stats(samples);

    console.log(
      `${label} steps — min: ${min.toFixed(2)} ms, ` +
      `max: ${max.toFixed(2)} ms, mean: ${mean.toFixed(2)} ms, ` +
      `median: ${median.toFixed(2)} ms`
    );
  });
}

window.benchmarkHarness = benchmarkHarness;



/* 
// performance testing for SO far, plenty of headroom for PPU/APU etc.
// HP Elitebook 850 G3 (2016) running Kubuntu
// to do: add tests from modern desktop, 13700k

Chrome
benchmarkHarness()
debug.js:83 Warm-up…
debug.js:78 10000 steps took 6.60 ms
debug.js:85 Benchmark…
debug.js:78 100000 steps took 18.10 ms
undefined
benchmarkHarness();
debug.js:83 Warm-up…
debug.js:78 10000 steps took 3.10 ms
debug.js:85 Benchmark…
debug.js:78 100000 steps took 23.20 ms
undefined
benchmarkHarness()
debug.js:83 Warm-up…
debug.js:78 10000 steps took 3.00 ms
debug.js:85 Benchmark…
debug.js:78 100000 steps took 25.20 ms
undefined
benchmarkHarness()
debug.js:83 Warm-up…
debug.js:78 10000 steps took 0.40 ms
debug.js:85 Benchmark…
debug.js:78 100000 steps took 4.60 ms


Chrome (fast enough)

=== Benchmarking CPU core ===
benchMarkTests.js:36 10k steps — min: 5.40 ms, max: 8.90 ms, mean: 6.38 ms, median: 5.60 ms
benchMarkTests.js:36 100k steps — min: 41.50 ms, max: 51.60 ms, mean: 47.63 ms, median: 48.70 ms
undefined
benchmarkHarness()
benchMarkTests.js:20 === Benchmarking CPU core ===
benchMarkTests.js:36 10k steps — min: 5.90 ms, max: 15.70 ms, mean: 10.17 ms, median: 9.55 ms
benchMarkTests.js:36 100k steps — min: 30.10 ms, max: 37.80 ms, mean: 34.15 ms, median: 34.35 ms
undefined
benchmarkHarness()
benchMarkTests.js:20 === Benchmarking CPU core ===
benchMarkTests.js:36 10k steps — min: 4.30 ms, max: 13.30 ms, mean: 7.65 ms, median: 6.50 ms
benchMarkTests.js:36 100k steps — min: 32.90 ms, max: 41.00 ms, mean: 37.08 ms, median: 37.20 ms


Firefox (the best by far)

=== Benchmarking CPU core === benchMarkTests.js:20:11
10k steps — min: 1.00 ms, max: 3.00 ms, mean: 1.50 ms, median: 1.00 ms 
100k steps — min: 8.00 ms, max: 11.00 ms, mean: 9.25 ms, median: 9.00 ms
benchmarkHarness()
=== Benchmarking CPU core === benchMarkTests.js:20:11
10k steps — min: 1.00 ms, max: 2.00 ms, mean: 1.25 ms, median: 1.00 ms 
100k steps — min: 7.00 ms, max: 8.00 ms, mean: 7.25 ms, median: 7.00 ms 
undefined
benchmarkHarness()
=== Benchmarking CPU core === benchMarkTests.js:20:11
10k steps — min: 0.00 ms, max: 1.00 ms, mean: 0.75 ms, median: 1.00 ms
100k steps — min: 7.00 ms, max: 10.00 ms, mean: 7.75 ms, median: 7.00 ms


waterfox (too slow, wtf?!)

benchmarkHarness()
=== Benchmarking CPU core === benchMarkTests.js:20:11
10k steps — min: 26.00 ms, max: 48.00 ms, mean: 41.75 ms, median: 46.50 ms
100k steps — min: 438.00 ms, max: 481.00 ms, mean: 460.75 ms, median: 462.00 ms
undefined
benchmarkHarness()
=== Benchmarking CPU core === benchMarkTests.js:20:11
10k steps — min: 48.00 ms, max: 52.00 ms, mean: 50.00 ms, median: 50.00 ms
100k steps — min: 419.00 ms, max: 480.00 ms, mean: 447.25 ms, median: 445.00 ms
undefined
benchmarkHarness()
=== Benchmarking CPU core === benchMarkTests.js:20:11
10k steps — min: 47.00 ms, max: 56.00 ms, mean: 51.50 ms, median: 51.50 ms
100k steps — min: 429.00 ms, max: 506.00 ms, mean: 450.25 ms, median: 433.00 ms
undefined


*/
