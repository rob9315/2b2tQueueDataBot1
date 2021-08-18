import { assert } from 'console';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { Client, ClientOptions, createClient } from 'minecraft-protocol';

const config: Partial<ClientOptions> & { credentials: ClientOptions[] } = JSON.parse(readFileSync('config.json').toString());
const accountsPerConnection = 2;

config.credentials = config.credentials.filter((v) => !!v.accessToken);

const cycledAccounts = config.credentials.reduce<ClientOptions[][]>((p, v, i) => {
  p[i % accountsPerConnection] ??= [];
  p[i % accountsPerConnection].push(v);
  return p;
}, []);

(async () => {
  for (const index in cycledAccounts) {
    const accArray = cycledAccounts[index];
    (async () => {
      let accountIndex = 0;
      while (++accountIndex)
        await new Promise<string>((res) => {
          const queueData: { [time: number]: [position: number, length: number] } = {};
          let queuelength: number;
          let prevpos: number;
          function cllog(this: Client, ...message: (string | { toString: () => string })[]) {
            console.log(`[${+index + 1}/${accountsPerConnection} ${this.username}]`, ...message);
          }
          function finalize(this: Client, message: string) {
            log(message);
            try {
              assert(statSync('queue').isDirectory());
            } catch {
              mkdirSync('queue');
            }
            writeFileSync(`queue/${Date.now()}.json`, JSON.stringify(queueData));
          }
          const log = cllog.bind(
            createClient({ ...config, ...accArray[accountIndex % accArray.length] })
              .on('end', finalize)
              .on('error', finalize)
              .on('packet', function (this: Client, data, { name }) {
                let pos: number | undefined;
                switch (name) {
                  case 'chat':
                    pos = parseChatMessage(data);
                    break;
                  case 'playerlist_header':
                    pos = parseTabMenu(data);
                    break;
                  case 'map_chunk':
                    queueData[Date.now()] = [0, queuelength];
                    this.end('Data received');
                    break;
                  case 'teams':
                    switch (data.mode) {
                      case 0:
                        queuelength = data.players.length;
                        break;
                      case 3:
                        queuelength += data.players.length;
                        break;
                      case 4:
                        queuelength -= data.players.length;
                        break;
                    }
                }
                if (pos) {
                  if (prevpos != pos) log(`${pos}/${queuelength}`);
                  queueData[Date.now()] = [pos, queuelength];
                  prevpos = pos;
                }
              })
              .on('session', function (this: Client) {
                log(`logged in`);
              })
          );
        });
    })();
    if (+index + 1 < accountsPerConnection) {
      console.log(`Starting next client in ${`${6 / accountsPerConnection}`.substr(0, 4)}h`);
      await new Promise((res) => setTimeout(res, 21600000 / accountsPerConnection));
    } else console.log(`Maximum number of accounts specified (${accountsPerConnection}) now in action`);
  }
})();

export function parseChatMessage(data: { message: string }) {
  try {
    return Number(JSON.parse(data.message).extra[1].text);
  } catch {}
}

export function parseTabMenu(data: { header: string }) {
  try {
    return Number((JSON.parse(data.header)?.text as string).match(/(?<=Position in queue: (?:§.)*)\d+/)?.[0]);
  } catch {}
}
