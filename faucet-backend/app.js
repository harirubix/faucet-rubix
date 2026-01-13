require("dotenv").config();

const express = require("express");
const fs = require("fs-extra");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet"); // for security headers
const app = express();
const crypto = require("crypto");
const axios = require("axios");
const counterFilePath = "counter.json";
const dbFilePath = "counter.db";
const FAUCET_ID = "faucettestrbt";

const sourceIp = process.env.ALLOWED_IP;
const origin = process.env.ORIGIN;
const requestWaitTimeInMilliseconds =
  process.env.REQUEST_WAIT_TIME_IN_SECONDS * 1000;
const nodeAddress = process.env.RUBIX_NODE_ADDRESS;
const port = process.env.SERVER_PORT | 3002;
const tokenRequestAmount = parseFloat(process.env.FAUCET_REQUEST_AMOUNT);
const faucetDid = process.env.FAUCET_DID;


// Initialize database
const db = new sqlite3.Database(dbFilePath, (err) => {
  if (err) {
    console.error("Failed to connect to database:", err);
  } else {
    console.log("Connected to SQLite database.");
    db.run(
      `CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            timestamp INTEGER
        )`,
      (err) => {
        if (err) {
          console.error("Error creating users table:", err.message);
        }
      }
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS token_level_details (
            faucetID TEXT PRIMARY KEY,
            token_level INTEGER,
            last_token_num INTEGER,
            total_count INTEGER,
            tokens_transferred INTEGER
        )`,
      (err) => {
        if (err) {
          console.error(
            "Error creating token_level_details table:",
            err.message
          );
        } else {
          // Insert initial values only after the table is created
          db.run(
            `INSERT OR IGNORE INTO token_level_details (faucetID, token_level, last_token_num, total_count,tokens_transferred) VALUES (?, ?, ?, ?,?)`,
            [FAUCET_ID, 1, 0, 0, 0],
            function (err) {
              if (err) {
                console.error("Error inserting initial values:", err.message);
              }
            }
          );
        }
      }
    );
  }
});

function calculateSHA3_256Hash(number) {
  // Convert number to string
  const numberString = number.toString();

  // Calculate SHA3-256 hash
  const hash = crypto
    .createHash("sha3-256")
    .update(numberString, "utf8")
    .digest("hex");

  return hash;
}

// Function to read the counter value from the file
const readCounterFromFile = async () => {
  try {
    const data = await fs.readFile(counterFilePath, "utf8");
    return JSON.parse(data).counter;
  } catch (error) {
    if (error.code === "ENOENT") {
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

app.use(
  cors({
    origin: origin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());
// Security headers
app.use(helmet());

// Rate limiter for the /increment endpoint
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 Mins
  max: 200, // Limit each IP to 200 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use("/increment", (req, res, next) => {
  const source_ip = req.ip; // Get the requester's IP address
  if (req.headers["x-forwarded-for"]) {
    const forwardedIps = req.headers["x-forwarded-for"].split(",");
    source_ip = forwardedIps[0]; // Get the first IP in the list (real client IP)
  }
  console.log("source_ip : ", source_ip);
  if (source_ip === sourceIp) {
    next(); // Skip the rate limiter for this IP
  } else {
    limiter(req, res, next); // Apply the rate limiter
  }
});

const allowedIPs = ["127.0.0.1", "::1"];

app.use((req, res, next) => {
  const source_ip = req.ip; // Get the requester's IP address
  if (req.headers["x-forwarded-for"]) {
    const forwardedIps = req.headers["x-forwarded-for"].split(",");
    source_ip = forwardedIps[0]; // Get the first IP in the list (real client IP)
    console.log("source_ip : ", forwardedIps);
  }

  console.log("access");
  const clientIP = req.socket.remoteAddress;

  console.log(clientIP);
  console.log("reqIP : ", req.ip);
  let formattedIP = clientIP;
  if (clientIP.startsWith("::ffff:")) {
    formattedIP = clientIP.split("::ffff:")[1];
  }
  if (
    req.path === "/api/get-faucet-quorums" ||
    req.path === "/api/current-token-value"
  ) {
    return next(); // Skip IP restrictions
  }
  if (allowedIPs.includes(formattedIP)) {
    next(); // Allow the request
  } else {
    res.status(403).json({
      status: false,
      message: "Access denied: Unauthorized IP or port",
    });
  }
});

app.get("/api/current-token-value", (req, res) => {
  db.get(
    `SELECT token_level AS token_level, faucetID AS faucet_id, last_token_num AS current_token_number, total_count AS total_count FROM token_level_details WHERE faucetID = ?`,
    [FAUCET_ID],
    (err, tokenDetails) => {
      if (err) {
        console.error(err.message);
        res.status(500).json({ status: false, message: "Database error" });
        return;
      }
      if (tokenDetails) {
        // Send the token details as JSON
        res.json(tokenDetails);
      } else {
        res.status(404).json({ status: false, message: "Token not found" });
      }
    }
  );
});

app.post("/api/update-token-value", (req, res) => {
  const { token_level, faucet_id, current_token_number, total_count } =
    req.body;
  // Update the database with the new token details
  db.run(
    `UPDATE token_level_details SET token_level = ?, last_token_num = ?, total_count=? WHERE faucetID = ?`,
    [token_level, current_token_number, total_count, faucet_id],
    function (err) {
      if (err) {
        console.error(err.message);
        res
          .status(500)
          .json({ status: false, message: "Database update error" });
        return;
      }
      res.json({ success: true, message: "Token info has been updated" });
    }
  );
});

const faucetQuorumList = [
  "bafybmihov5kiw3ngsdkv64vy2fgqba4j32teb4ov2ttv5zzfksiubdlvje",
];
// Define the endpoint to add faucet quorums
app.get("/api/get-faucet-quorums", (req, res) => {
  res.json(faucetQuorumList);
});

// The function which converts the milliseconds into
// an appropriate string based format
// Its either in minutes or hour-minutes if minutes is greater than 60
const formatWaitTime = (milliseconds) => {
  // Convert milliseconds to total seconds
  const totalSeconds = Math.floor(milliseconds / 1000);

  // If less than 60 seconds, show only seconds
  if (totalSeconds < 60) {
    return `${totalSeconds} sec${totalSeconds !== 1 ? "s" : ""}`;
  }

  // Convert to total minutes
  const totalMinutes = Math.floor(milliseconds / (1000 * 60));

  // If less than 60 minutes, show only minutes
  if (totalMinutes < 60) {
    return `${totalMinutes} min${totalMinutes !== 1 ? "s" : ""}`;
  }

  // Calculate hours and remaining minutes
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  // Build the display string
  if (minutes === 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} min${
    minutes !== 1 ? "s" : ""
  }`;
};

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
    db.run(query, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
};

app.post("/increment", async (req, res) => {
  console.log("Increment endpoint called"); // Log when the endpoint is called
  console.log("Request body:", req.body);

  const { username } = req.body;

  if (!username || typeof username !== "string") {
    return res.status(400).send("Username is required and must be a string");
  }

  const currentTime = Date.now();
  console.log("Current Time:", currentTime);
  // Check if the user has made a request within the last hour
  try {
    const userRow = await dbGetAsync(
      "SELECT timestamp FROM users WHERE username = ?",
      [username]
    );
    console.log("User Row:", userRow);
    if (userRow) {
      const lastRequestTime = userRow.timestamp;
      const timeElapsed = currentTime - lastRequestTime;

      if (timeElapsed < requestWaitTimeInMilliseconds) {
        const timeLeft = requestWaitTimeInMilliseconds - timeElapsed;
        const timeLeftStr = formatWaitTime(timeLeft);
        return res.status(429).send({
          status: false,
          message: `Request denied. Try again in ${timeLeftStr}`,
        });
      }
    }
    // Update the user's timestamp
    console.log("Updating user timestamp");
    await dbRunAsync("REPLACE INTO users (username, timestamp) VALUES (?, ?)", [
      username,
      currentTime,
    ]);
    console.log("User timestamp updated");
    // Increment the counter and write it to the file
    counter++;
    console.log("New Counter Value:", counter);
    await writeCounterToFile(counter);
    console.log("Counter value written to file");
    const hash = calculateSHA3_256Hash(counter);
    console.log("Calculated Hash:", hash);
    // First API request

    try {
      //const tokenRow = await dbGetAsync(`SELECT total_count, tokens_transferred FROM token_level_details WHERE faucetID = ?`, [FAUCET_ID]);
      //const difference = tokenRow.total_count - tokenRow.tokens_transferred;

      const getAccountInfoUrl = `${nodeAddress}/api/get-account-info?did=${username}`;

      const response = await axios.get(getAccountInfoUrl, {
        headers: {
          Accept: "application/json",
        },
      });
      console.log("token balance response : ", response.data);
      if (
        response.data &&
        response.data.account_info &&
        response.data.account_info.length > 0
      ) {
        const rbtAmount = response.data.account_info[0].rbt_amount;
        console.log("rbt Amount : ", rbtAmount);

        if (rbtAmount < 50) {
          // First API request
          const firstApiUrl = `${nodeAddress}/api/generate-faucettest-token`;
          const firstRequestData = {
            did: process.env.FAUCET_DID,
            token_count: 100,
          };

          const firstResponse = await axios.post(
            firstApiUrl,
            firstRequestData,
            {
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
            }
          );

          const id = firstResponse.data.result.id;
          console.log(id);

          // Second API request
          const secondApiUrl = `${nodeAddress}/api/signature-response`;
          const secondRequestData = {
            id: id,
            password: "mypassword",
          };

          const secondResponse = await axios.post(
            secondApiUrl,
            secondRequestData,
            {
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
            }
          );
          console.log("Second API Response:", secondResponse.data);
        }
      }
    } catch (error) {
      console.error("Error fetching token level details:", error);
    }

    console.log("Initiating RBT Transfer:", initiateTransferData);

    const initiateTransferURL = `${nodeAddress}/api/initiate-rbt-transfer`;
    const initiateTransferData = {
      comment: "",
      receiver: username,
      sender: faucetDid,
      tokenCount: tokenRequestAmount,
      type: 2,
    };

    const initiateTransferResponse = await axios.post(
      initiateTransferURL,
      initiateTransferData,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );
    const initiateTransferResponseBody = initiateTransferResponse.data;
    if (!initiateTransferResponseBody["status"]) {
      console.error(
        "error occured while calling RBT Transfer API, error: ",
        apiRespBody["message"]
      );
      res.status(500).send({ error: "internal server error" });
      return;
    }

    const id = initiateTransferResponseBody.result.id;

    // Second API request
    const signatureResponseURL = `${nodeAddress}/api/signature-response`;
    const signatureResponseData = {
      id: id,
      password: "mypassword",
    };

    const signatureResponse = await axios.post(
      signatureResponseURL,
      signatureResponseData,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Second API Response:", signatureResponse.result);

    // Update tokens_transferred in the database

    if (signatureResponse.data && signatureResponse.data.message) {
      if (
        signatureResponse.data.message.includes(
          "Transfer finished successfully"
        )
      ) {
        // Update tokens_transferred in the database
        await dbRunAsync(
          `UPDATE token_level_details SET tokens_transferred = tokens_transferred + ? WHERE faucetID = ?`,
          [tokenRequestAmount, FAUCET_ID]
        );
        console.log("Database updated successfully.");
      } else {
        console.log(
          "Transaction not successful:",
          signatureResponse.data.message
        );
        res.json({
          success: false,
          message: `failed to transfer tokens, err: ${signatureResponse.data["message"]}}`,
        });
        return;
      }
    } else {
      res.json({
        success: false,
        message: `failed to transfer tokens, err: ${signatureResponse.data["message"]}}`,
      });
      console.log("Invalid response from second API:", signatureResponse.data);
      return;
    }

    //   await dbRunAsync(
    //   `UPDATE token_level_details SET tokens_transferred = tokens_transferred + ? WHERE faucetID = ?`,
    //   [tokenCount, FAUCET_ID]
    //   );

    // Send the final response after all operations are done
    res.json({ success: true, message: hash });
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .send({ success: false, message: `Error processing the request.` });
    return;
  }
  console.log("Increment process completed for user:", username);
  // Retrieve and check the difference between total_count and tokens_transferred
});

// Start the server after initializing the counter
initializeCounter()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize the counter:", err);
  });
