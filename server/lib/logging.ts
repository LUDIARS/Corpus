import {
  install as installVestigium,
  type Vestigium,
  type Writer,
} from '@ludiars/vestigium';

let writer: Writer | undefined;

export function installLogging(): Vestigium {
  if (writer) throw new Error('Corpus logging is already installed');
  const vestigium = installVestigium({
    serviceCode: 'corpus',
    captureConsole: true,
    pinoTransport: false,
  });
  writer = vestigium.writer;
  return vestigium;
}

export function writeDiagnostic(msg: string, ctx: Record<string, unknown>): void {
  if (!writer) throw new Error('Corpus logging is not installed');
  writer.write({ level: 'info', msg, channel: 'app', ctx });
}
