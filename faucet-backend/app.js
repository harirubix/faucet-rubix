const express = require('express');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet'); // for security headers
const app = express();
const port = 3001;
const crypto = require('crypto');
const axios = require('axios');
const counterFilePath = 'counter.json';
const dbFilePath = 'counter.db';

// Initialize database
const db = new sqlite3.Database(dbFilePath, (err) => {
    if (err) {
        console.error('Failed to connect to database:', err);
    } else {
        console.log('Connected to SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            timestamp INTEGER
        )`, (err) => {
          if (err) {
              console.error('Error creating users table:', err.message);
          }
      });
        db.run(`CREATE TABLE IF NOT EXISTS token_level_details (
            faucetID TEXT PRIMARY KEY,
            token_level INTEGER,
            last_token_num INTEGER,
            total_count INTEGER,
            tokens_transferred INTEGER
        )`, (err) => {
          if (err) {
              console.error('Error creating token_level_details table:', err.message);
          } else {
              // Insert initial values only after the table is created
              db.run(`INSERT OR IGNORE INTO token_level_details (faucetID, token_level, last_token_num, total_count,tokens_transferred) VALUES (?, ?, ?, ?,?)`, 
              ["faucettest1", 1, 0, 0, 0], 
              function(err) {
                  if (err) {
                      console.error("Error inserting initial values:", err.message);
                  }
              });
          }
      });
    }
});


function calculateSHA3_256Hash(number) {
    // Convert number to string
    const numberString = number.toString();
    
    // Calculate SHA3-256 hash
    const hash = crypto.createHash('sha3-256').update(numberString, 'utf8').digest('hex');
    
    return hash;
}

// Function to read the counter value from the file
const readCounterFromFile = async () => {
    try {
        const data = await fs.readFile(counterFilePath, 'utf8');
        return JSON.parse(data).counter;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File does not exist, return initial counter value of 0
            return 0;
        } else {
            throw error;
        }
    }
};

// Function to write the counter value to the file
const writeCounterToFile = async (counter) => {
    const data = { counter };
    await fs.writeFile(counterFilePath, JSON.stringify(data, null, 2));
};

// Initialize the counter value
let counter = 0;

const initializeCounter = async () => {
    counter = await readCounterFromFile();
};

app.use(cors({
    origin: 'http://103.209.145.177:3000',
    methods: ['GET', 'POST','OPTIONS'],
    allowedHeaders: ['Content-Type'],
}));
app.use(express.json());
// Security headers
app.use(helmet());

// Rate limiter for the /increment endpoint
const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 60 Mins
    max: 200, // Limit each IP to 200 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
});
app.use('/increment', (req, res, next) => {
    const source_ip = req.ip; // Get the requester's IP address
    if (source_ip === '103.209.145.177') {
        next(); // Skip the rate limiter for this IP
    } else {
        limiter(req, res, next); // Apply the rate limiter
    }
});

const allowedIPs = ['localhost', '::1', '127.0.0.1','103.209.145.177'];

// Allow only requests from 127.0.0.1
app.use((req, res, next) => {
    console.log("access")
    const clientIP = req.socket.remoteAddress;
    
    console.log(clientIP)

    let formattedIP = clientIP;
    if (clientIP.startsWith('::ffff:')) {
        formattedIP = clientIP.split('::ffff:')[1];
    }
    if (allowedIPs.includes(formattedIP)) {
        next(); // Allow the request
    } else {
        res.status(403).json({ error: 'Access denied: Unauthorized IP or port' });
    }
});

app.get('/api/current-token-value', (req, res) => {
    db.get(`SELECT token_level AS token_level, faucetID AS faucet_id, last_token_num AS current_token_number, total_count AS total_count FROM token_level_details WHERE faucetID = ?`, ["faucettest1"], (err, tokenDetails) => {
        if (err) {
          console.error(err.message);
          res.status(500).json({ error: "Database error" });
          return;
        }
        if (tokenDetails) {
          // Send the token details as JSON
          res.json(tokenDetails);
        } else {
          res.status(404).json({ error: "Token not found" });
        }
      });
  });

app.post('/api/update-token-value', (req, res) => {
    const { token_level, faucet_id, current_token_number, total_count } = req.body;
    // Update the database with the new token details
    db.run(
    `UPDATE token_level_details SET token_level = ?, last_token_num = ?, total_count=? WHERE faucetID = ?`,
    [token_level, current_token_number, total_count, faucet_id],
    function (err) {
      if (err) {
        console.error(err.message);
        res.status(500).json({ error: "Database update error" });
        return;
      }
      res.json({ success: true });
    }
  );
  });

// Promisified db.get function
const dbGetAsync = (query, params) => {
  return new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
          if (err) {
              reject(err);
          } else {
              resolve(row);
          }
      });
  });
};

// Promisified db.run function
const dbRunAsync = (query, params) => {
  return new Promise((resolve, reject) => {
      db.run(query, params, function(err) {
          if (err) {
              reject(err);
          } else {
              resolve(this);
          }
      });
  });
};

app.post('/increment', async (req, res) => {
  let tokenCount = 1.0;
  const { username } = req.body;

  if (!username || typeof username !== 'string') {
      return res.status(400).send('Username is required and must be a string');
  }

  const currentTime = Date.now();
  const oneHour = 3600000;

  try {
      // Check if the user has made a request within the last hour
      const userRow = await dbGetAsync('SELECT timestamp FROM users WHERE username = ?', [username]);

      if (userRow) {
          const lastRequestTime = userRow.timestamp;
          if (currentTime - lastRequestTime < oneHour) {
              return res.status(429).send('Request denied. Try again after one hour.');
          }
      }

      // Update the user's timestamp
      await dbRunAsync('REPLACE INTO users (username, timestamp) VALUES (?, ?)', [username, currentTime]);

      // Increment the counter and write it to the file
      counter++;
      await writeCounterToFile(counter);
      const hash = calculateSHA3_256Hash(counter);

      // First API request
      const firstApiUrl = 'http://localhost:20000/api/initiate-rbt-transfer';
      const firstRequestData = {
          comment: "",
          receiver: username,
          sender: "bafybmif2cnmxooupsefy2rdy3vf3yt7xoojess4zedmoqvh3neezhi6uyq",
          tokenCount: tokenCount,
          type: 2
      };

      const firstResponse = await axios.post(firstApiUrl, firstRequestData, {
          headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
          }
      });

      const id = firstResponse.data.result.id;

      // Second API request
      const secondApiUrl = 'http://localhost:20000/api/signature-response';
      const secondRequestData = {
          id: id,
          password: 'mypassword'
      };

      const secondResponse = await axios.post(secondApiUrl, secondRequestData, {
          headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
          }
      });

      console.log('Second API Response:', secondResponse.data);

      // Update tokens_transferred in the database
      await dbRunAsync(
          `UPDATE token_level_details SET tokens_transferred = tokens_transferred + ?`,
          [tokenCount]
      );

      // Send the final response after all operations are done
      res.json({ success: true, hash });

  } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Error processing the request.');
  }

  // Retrieve and check the difference between total_count and tokens_transferred
  try {
    const tokenRow = await dbGetAsync(`SELECT total_count, tokens_transferred FROM token_level_details WHERE faucetID = ?`, ['faucettest1']);
    const difference = tokenRow.total_count - tokenRow.tokens_transferred;

    if (difference < 50) {
        // First API request
      const firstApiUrl = 'http://localhost:20000/api/generate-faucettest-token';
      const firstRequestData = {
          did: "bafybmif2cnmxooupsefy2rdy3vf3yt7xoojess4zedmoqvh3neezhi6uyq",
          token_count: 5,
      };

      const firstResponse = await axios.post(firstApiUrl, firstRequestData, {
          headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
          }
      });

      const id = firstResponse.data.result.id;
      console.log(id)

      // Second API request
      const secondApiUrl = 'http://localhost:20000/api/signature-response';
      const secondRequestData = {
          id: id,
          password: 'mypassword'
      };

      const secondResponse = await axios.post(secondApiUrl, secondRequestData, {
          headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
          }
      });

      console.log('Second API Response:', secondResponse.data);

    }
} catch (error) {
    console.error('Error fetching token level details:', error);
}
});



// Start the server after initializing the counter
initializeCounter().then(() => {
    app.listen(port,'0.0.0.0', () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
}).catch(err => {
    console.error('Failed to initialize the counter:', err);
});