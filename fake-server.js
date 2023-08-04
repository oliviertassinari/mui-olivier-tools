const express = require('express')
const app = express()
const port = 80

app.get('/', (req, res) => {
  const arr = [1, 2, 3, 4, 5, 6, 9, 7, 8, 9, 10];
  arr.reverse();
  const used = process.memoryUsage();
  let log = '';
  for (let key in used) {
    log += `${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB\n`;
  }

  res.send(`Hello World! ${log}`)
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
