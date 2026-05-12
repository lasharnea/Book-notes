import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import ejs from "ejs";
import "dotenv/config";
import axios from "axios";

const app = express();
const port = 3000;

const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});
db.connect();

async function fetchBooks() {
  try { 
    const result = await db.query("SELECT * FROM books");
    return result.rows;
  } catch (error) {
    console.error("Error fetching books:", error);
    return [];
  }
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

app.get("/", async (req, res) => {
  const books = await fetchBooks();
  res.render("index", { books });
});

app.post("/add", async (req, res) => {});

app.post("/edit", async (req, res) => {});

app.post("/delete", async (req, res) => {});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
}); 