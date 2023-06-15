const PORT = process.env.APP_PORT || 8080;
const express = require("express");
const { MongoClient } = require("mongodb");
const { v1: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const { error } = require("console");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());
app.use(express.json({ limit: "5mb" }));
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
  },
});
const dotenv = require("dotenv");
dotenv.config();
const uri = 'mongodb+srv://anjelostoqnov:tinderpassword@cluster1.qy0pp21.mongodb.net/?retryWrites=true&w=majority'

const client = new MongoClient(uri);
client.connect();
const databaseName = client.db("app-data");
const sessions = databaseName.collection("sessions");
const users = databaseName.collection("users");
const messages = databaseName.collection("messages");

function getToken(dbUser) {
  const token = jwt.sign(
    { user_id: dbUser.user_id, email: dbUser.email },
    process.env.JWT_SECRET_KEY,
    {
      expiresIn: 60 * 60 * 24,
    }
  );
  return token;
}
app.post("/signup", async (req, res) => {
  // const client = new MongoClient(uri);
  const { email, password } = req.body;
  try {
    const users = databaseName.collection("users");
    const existingUser = await users.findOne({ email });
    if (existingUser)
      return res.status(409).send("User already exists. Please login");

    const generatedUserId = uuidv4();
    const hashedPassword = await bcrypt.hash(password.trim(), 10);
    const sanitizedEmail = email.toLowerCase().trim();

    const data = {
      user_id: generatedUserId,
      email: sanitizedEmail,
      hashes_password: hashedPassword,
      photos: [null, null, null, null, null],
      matches: [],
      gender_interest: "woman",
    };
    const insertedUser = await users.insertOne(data);

    const token = getToken(insertedUser);
    res.status(201).json({ token, userId: generatedUserId });
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await users.findOne({ email });
    const correctPassword = await bcrypt.compare(
      password,
      user.hashes_password
    );

    if (user && correctPassword) {
      const token = getToken(user);
      // Insert token into "Sessions" collection
      await sessions.insertOne({ userId: user.user_id });

      return res.status(200).json({ token, userId: user.user_id });
    }

    return res.status(401).send("Invalid Credentials");
  } catch (err) {
    console.log(err);
    //log error to db.
    res.status(500).send("Ooops Something wernt wrong.");
  }
});

//LOGOUT ROUTE
app.delete("/logout", async (req, res) => {
  const { userId } = req.body;

  try {
    await sessions.deleteOne(userId);

    res.status(200).send("Logged out successfully");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error logging out");
  } finally {
    //  SOMETHING
  }
});

app.get("/sessions/userIds", async (req, res) => {
  try {
    // Retrieve an array of all userIds from the sessions collection
    const userIds = await sessions.distinct("userId");

    res.status(200).json(userIds);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error retrieving userIds");
  }
});

// GET all users by gender
app.get("/users", async (req, res) => {
  try {
    const { gender } = req.query;
    const query = { gender_identity: { $eq: gender } };

    const foundUsers = await users.find(query).toArray();
    res.status(200).json(foundUsers);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal server error");
  }
});

app.put("/user/:user_id/paymentstatus", async (req, res) => {
  const user_id = req.params.user_id;
  const paymentStatus = req.body.paymentStatus;

  try {
    const query = { user_id: user_id };
    const updateDocument = {
      $set: {
        paymentStatus: paymentStatus,
      },
    };

    const updatedUser = await users.updateOne(query, updateDocument);

    if (updatedUser.modifiedCount === 1) {
      res.send("User payment status updated successfully");
    } else {
      res.status(404).send("User not found");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal server error");
  }
});
// CHANGE USER CHARACTERISTICS
app.put("/users/:userId", async (req, res) => {
  const userId = req.get("identity");
  if (!userId) {
    res.status(401).send({ message: "You are not logged in!" });
    return;
  }

  try {
    const query = { user_id: req.params.userId };
    const foundUser = await users.findOne(query); // check if the user ID exists
    if (!foundUser) {
      res.status(401).send({ message: "Invalid user ID!" }); // respond with an error if the user ID is invalid
      return;
    }

    if (userId !== req.params.userId) {
      // check if the authenticated user matches the user being updated
      res
        .status(401)
        .send({ message: "You do not have permission to update this user!" });
      return;
    }

    const formData = req.body.formData;
    const updateDocument = {
      $set: {
        first_name: formData.first_name,
        dob_day: formData.dob_day,
        dob_month: formData.dob_month,
        dob_year: formData.dob_year,
        show_gender: formData.show_gender,
        gender_identity: formData.gender_identity,
        gender_interest: formData.gender_interest,
        age_interest: formData.age_interest,
        photos: formData.photos,
        about: formData.about,
        matches: formData.matches,
      },
    };

    const updatedUser = await users.updateOne(query, updateDocument);
    res.send(updatedUser);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Something went wrong" });
  }
});

// GETTING USER BY ID
app.get("/user", async (req, res) => {
  // const client = new MongoClient(uri);
  const userId = req.query.userId;

  try {
    const query = { user_id: userId };
    const user = await users.findOne(query);

    res.send(user);
  } catch {
    console.log(error);
  } finally {
    // await client.close()
  }
});

// CHANGE USERS CHARACTERISTICS
app.put("/user", async (req, res) => {
  // const client = new MongoClient(uri);
  const formData = req.body.formData;

  try {
    // await client.connect()
    const queary = { user_id: formData.user_id };
    const updateDocument = {
      $set: {
        first_name: formData.first_name,
        dob_day: formData.dob_day,
        dob_month: formData.dob_month,
        dob_year: formData.dob_year,
        show_gender: formData.show_gender,
        gender_identity: formData.gender_identity,
        gender_interest: formData.gender_interest,
        age_interest: formData.age_interest,
        photos: formData.photos,
        about: formData.about,
        matches: formData.matches,
      },
    };
    const insertedUser = await users.updateOne(queary, updateDocument);
    res.send(insertedUser);
  } finally {
    // await client.close()
  }
});

// Update a user's matches
// PUT /users/:userId/matches/:matchedUserId

app.put("/users/:userId/matches/:matchedUserId", async (req, res) => {
  const userId = req.get("identity");
  if (!userId) {
    res.status(401).send({ message: "You are not logged in!" });
    return;
  }

  const { matchedUserId } = req.params;

  try {
    const database = client.db("app-data");
    const users = database.collection("users");

    const query = { user_id: userId };
    const updateDocument = {
      $push: { matches: { user_id: matchedUserId } },
    };
    await users.updateOne(query, updateDocument);
    const updatedUser = await users.findOne(query);
    res.send(updatedUser.matches);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal server error");
  }
});

// GET ALL USERS BY USER ID
app.get("/usersIds", async (req, res) => {
  // const client = new MongoClient(uri)

  const userIds = req.query.userIds.split(",");

  try {
    // await client.connect()
    const database = client.db("app-data");
    const users = database.collection("users");
    const pipeline = [
      {
        $match: {
          user_id: {
            $in: userIds,
          },
        },
      },
    ];

    const foundUsers = await users.aggregate(pipeline).toArray();

    res.json(foundUsers);
  } catch {
    console.log(error);
  }
});

// SET LOCATION OF USER

app.put("/user/:user_id/location", async (req, res) => {
  const user_id = req.params.user_id;
  const location = req.body.location;

  try {
    const databaseName = client.db("app-data");
    const users = databaseName.collection("users");

    const query = { user_id: user_id };
    const updateDocument = {
      $set: {
        location: location,
      },
    };

    const updatedUser = await users.updateOne(query, updateDocument);

    if (updatedUser.modifiedCount === 1) {
      res.send("User location updated successfully");
    } else {
      res.status(404).send("User not found");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal server error");
  }
});

// MESSAGES BETWEEN userId and correspondingUserId

app.get("/users/:userId/messages/:correspondingUserId", async (req, res) => {
  const { userId, correspondingUserId } = req.params;

  try {
    const query = {
      $or: [
        { from: userId, to: correspondingUserId },
        { from: correspondingUserId, to: userId },
      ],
    };
    const foundMessages = await messages
      .find(query)
      .sort({ timestamp: 1 })
      .toArray(); // sort by timestamp in descending order
    io.emit("messages", foundMessages);
    res.send(foundMessages);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal server error");
  }
});

app.post("/payment", async (req, res) => {
  let { amount, id } = req.body;
  try {
    await stripe.paymentIntents.create({
      amount,
      currency: "USD",
      description: "Tinder IT Talants",
      payment_method: id,
      confirm: true,
    });
    res.json({
      message: "Payment successful",
      success: true,
    });
  } catch (error) {
    console.log("Error", error);
    res.json({
      message: "Payment failed",
      success: false,
    });
  }
});

// ADD MESSAGES Database
app.post("/message", async (req, res) => {
  const message = req.body.message;

  try {
    const database = client.db("app-data");
    const messages = database.collection("messages");

    const insertedMessage = await messages.insertOne(message);

    //    io.emit('message', insertedMessage) // Emit the new message to all connected clients
    res.send(insertedMessage);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal server error");
  }
});

io.on("connection", (socket) => {
  console.log(`Socket ${socket.id} connected`);
  //db add session to sessions collection

  socket.on("message", (data) => {
    io.sockets.emit("messageRes", data);
  });

  socket.on("disconnect", () => {
    console.log(`Socket ${socket.id} disconnected`);
    //db remove sessio from sessions collection
  });
});

server.listen(PORT, () => {
  console.log(`Server running on PORT ${PORT}`);
});
