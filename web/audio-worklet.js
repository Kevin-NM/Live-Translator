class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputBuffer = [];
    this.position = 0;
    this.outputBuffer = [];
    this.ratio = sampleRate / 16000;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels[0]) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.inputBuffer.push(value);
    }
    while (this.position + 1 < this.inputBuffer.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      const sample = this.inputBuffer[left] * (1 - fraction) + this.inputBuffer[left + 1] * fraction;
      this.outputBuffer.push(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))));
      this.position += this.ratio;
      if (this.outputBuffer.length === 3200) {
        const packet = new Int16Array(this.outputBuffer);
        this.port.postMessage(packet.buffer, [packet.buffer]);
        this.outputBuffer = [];
      }
    }
    const consumed = Math.min(Math.floor(this.position), this.inputBuffer.length - 1);
    if (consumed > 0) {
      this.inputBuffer.splice(0, consumed);
      this.position -= consumed;
    }
    return true;
  }
}
registerProcessor('pcm-downsampler', PcmDownsampler);
