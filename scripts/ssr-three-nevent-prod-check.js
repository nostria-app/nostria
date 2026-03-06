const https = require('https');
const { runNeventCheck } = require('./ssr-three-nevent-check-core');

const paths = [
  '/e/nevent1qvzqqqqqqypzq0mhp4ja8fmy48zuk5p6uy37vtk8tx9dqdwcxm32sy8nsaa8gkeyqydhwumn8ghj7un9d3shjtnwdaehgunsd3jkyuewvdhk6tcqyz8x3mduhgzj4ur67x36ln04x4rskm3k5svy5546kvp6wzk792sc2eahrzr',
  '/e/nevent1qvzqqqqqqypzpjh9kl4rfzh7l3xpq2ahkyjufy50z9rnngnmsa7xhna7tfujsquyqythwumn8ghj7un9d3shjtnswf5k6ctv9ehx2ap0qqsqmccmvfunjuxhchhd9k0rf59369jk76dt4pw842j45s25ltt2aack354dd',
  '/e/nevent1qvzqqqqqqypzqa7w2muf6y3g7llnws7wrtgmy4y90wgqs4j8yl4atg0nzumz7m98qy88wumn8ghj7mn0wvhxcmmv9uqzqmfmpqlgq5gz9yed3gfxk2l68qqwus07s646jl0vwnc24encv6ks4duch4',
];

runNeventCheck({
  transport: https,
  options: {
    hostname: 'nostria.app',
    userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    timeoutMs: 12000,
  },
  paths,
  rounds: 3,
});
