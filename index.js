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


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

app.get("/", async (req, res) => {
try {
  const search = req.query.search;
const sort = req.query.sort;
  let query = "SELECT * FROM books";
    let values = [];

    if (search) {
      query += " WHERE title ILIKE $1 OR notes ILIKE $1";
      values.push(`%${search}%`);
    }

    if (sort === "date_asc") {
      query += " ORDER BY date_read ASC";
    } else if (sort === "date_desc") {
      query += " ORDER BY date_read DESC";
    } else if (sort === "rating_asc") {
      query += " ORDER BY rating ASC";
    } else if (sort === "rating_desc") {
      query += " ORDER BY rating DESC";
    } else if (sort === "title_asc") {
      query += " ORDER BY title ASC";
    } else {
      query += " ORDER BY id DESC";
    }
    const result = await db.query(query, values);

    res.render("index.ejs", {
      books: result.rows,
      search: search,
      sort: sort,
    });
  } catch (err) {
    console.log(err);
    res.send("Something went wrong");
  }
});

app.post("/add", async (req, res) => {
  try {
    const { title, author, date_read, rating, favourite, notes } = req.body;

    const openLibraryUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`;

    const response = await axios.get(openLibraryUrl);

    const coverId = response.data.docs[0]?.cover_i;

    const coverUrl = coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
      : null;

    await db.query(
      "INSERT INTO books (title, author, date_read, rating, notes, cover_id, cover_url) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [title, author, date_read, rating, notes, coverId, coverUrl]
    );

    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.send("Something went wrong");
  }
});



app.post("/edit", async (req, res) => {
  const { id, title, author, date_read, rating, notes } = req.body;
  try {
    await db.query(
      "UPDATE books SET title = $1, author = $2, date_read = $3, rating = $4, notes = $5 WHERE id = $6",
      [title, author, date_read, rating, notes, id]
    );
    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.send("Something went wrong");
  }
});


app.post("/delete", async (req, res) => {
  const { id } = req.body;
  try {
    await db.query("DELETE FROM books WHERE id = $1", [id]);
    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.send("Something went wrong");
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
}); 