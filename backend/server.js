require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();


app.use(cors());
app.use(express.json());
const uploadDir =
    path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage =
    multer.diskStorage({

        destination: function(req, file, cb) {
            cb(null, uploadDir);
        },

        filename: function(req, file, cb) {

            const uniqueName =
                Date.now() +
                "-" +
                Math.round(Math.random() * 1000000) +
                ".webm";

            cb(null, uniqueName);
        }
    });

const upload =
    multer({
        storage: storage,
        limits: {
            fileSize: 100 * 1024 * 1024
        }
    });

app.use(
    "/uploads",
    express.static(uploadDir)
);

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

db.connect((error) => {
    if (error) {
        console.error("MySQL connection failed:", error.message);
        return;
    }

    console.log("MySQL connected successfully!");
});

const PORT = process.env.PORT || 3000;
app.get("/api/test", (req, res) => {
    res.json({
        message: "Backend is working!",
        database: "MySQL connected"
    });
});
app.post("/api/register", async (req, res) => {
    const { name, email, username, password, role, age } = req.body;

    if (!name || !email || !username || !password || !role) {
        return res.status(400).json({
            message: "Please fill all required fields"
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO users (name, email, username, password, role, age)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [name, email, username, hashedPassword, role, age || ""],
            (error, result) => {
                if (error) {
                    if (error.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({
                            message: "Username already exists"
                        });
                    }

                    console.error("Registration error:", error.message);

                    return res.status(500).json({
                        message: "Failed to create account"
                    });
                }

                res.status(201).json({
                    message: "Account created successfully",
                    userId: result.insertId
                });
            }
        );
    } catch (error) {
        console.error("Password hashing error:", error.message);

        res.status(500).json({
            message: "Server error"
        });
    }
});
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: "Please enter username and password"
        });
    }

    const sql = "SELECT * FROM users WHERE username = ?";

    db.query(sql, [username], async (error, results) => {
        if (error) {
            return res.status(500).json({
                message: "Server error"
            });
        }

        if (results.length === 0) {
            return res.status(401).json({
                message: "Invalid username or password"
            });
        }

        const user = results[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid username or password"
            });
        }

        res.json({
            message: "Login successful",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                username: user.username,
                role: user.role,
                age: user.age
            }
        });
    });
});
app.post("/api/activities", (req, res) => {
    const { student_username, title, description } = req.body;

    if (!student_username || !title || !description) {
        return res.status(400).json({
            message: "Please provide student, title and description"
        });
    }

    const sql = `
        INSERT INTO activities
        (student_username, title, description)
        VALUES (?, ?, ?)
    `;

    db.query(
        sql,
        [student_username, title, description],
        (error, result) => {
            if (error) {
                console.error("Activity error:", error.message);

                return res.status(500).json({
                    message: "Failed to assign activity"
                });
            }

            res.status(201).json({
                message: "Activity assigned successfully",
                activityId: result.insertId
            });
        }
    );
});
app.get("/api/activities/:student_username", (req, res) => {
    const studentUsername = req.params.student_username;

    const sql = `
        SELECT
            id,
            student_username,
            title,
            description,
            answer,
            submitted,
            assigned_date,
            submitted_date
        FROM activities
        WHERE student_username = ?
        ORDER BY id DESC
    `;

    db.query(sql, [studentUsername], (error, results) => {
        if (error) {
            console.error("Get activities error:", error.message);

            return res.status(500).json({
                message: "Failed to load activities"
            });
        }

        res.json(results);
    });
});
app.put("/api/activities/:id/submit", (req, res) => {
    const activityId = req.params.id;
    const { answer } = req.body;

    if (!answer || answer.trim() === "") {
        return res.status(400).json({
            message: "Please provide an answer"
        });
    }

    const sql = `
        UPDATE activities
        SET answer = ?,
            submitted = TRUE,
            submitted_date = NOW()
        WHERE id = ?
    `;

    db.query(
        sql,
        [answer.trim(), activityId],
        (error, result) => {
            if (error) {
                console.error("Submit activity error:", error.message);

                return res.status(500).json({
                    message: "Failed to submit activity"
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Activity not found"
                });
            }

            res.json({
                message: "Activity submitted successfully"
            });
        }
    );
});
app.post("/api/progress", (req, res) => {

    const {
        student_username,
        activities_completed,
        quiz_score,
        last_quiz_score,
        badge
    } = req.body;

    if (!student_username) {
        return res.status(400).json({
            message: "Student username is required"
        });
    }

    const today = new Date().toLocaleDateString(
        "en-CA",
        {
            timeZone: "Asia/Kolkata"
        }
    );

    const selectSql = `
        SELECT streak, last_study_date
        FROM student_progress
        WHERE student_username = ?
    `;

    db.query(
        selectSql,
        [student_username],
        (error, results) => {

            if (error) {
                console.error(
                    "Progress read error:",
                    error.message
                );

                return res.status(500).json({
                    message: "Failed to read progress"
                });
            }

            let streak = 1;

            if (results.length > 0) {

                const oldStreak =
                    Number(results[0].streak) || 0;

                const lastStudyDate =
                    results[0].last_study_date;

                if (!lastStudyDate) {

                    streak = Math.max(
                        1,
                        oldStreak
                    );

                } else {

                    const lastDate =
                        new Date(
                            String(lastStudyDate)
                                .substring(0, 10) +
                            "T00:00:00Z"
                        );

                    const todayDate =
                        new Date(
                            today +
                            "T00:00:00Z"
                        );

                    const difference =
                        Math.round(
                            (todayDate - lastDate) /
                            (1000 * 60 * 60 * 24)
                        );

                    if (difference === 1) {

                        streak =
                            oldStreak + 1;

                    } else if (difference === 0) {

                        streak =
                            Math.max(
                                1,
                                oldStreak
                            );

                    } else {

                        streak = 1;
                    }
                }
            }

            const insertSql = `
                INSERT INTO student_progress
                (
                    student_username,
                    activities_completed,
                    quiz_score,
                    last_quiz_score,
                    streak,
                    badge,
                    last_study_date
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)

                ON DUPLICATE KEY UPDATE
                    activities_completed =
                        VALUES(activities_completed),

                    quiz_score =
                        VALUES(quiz_score),

                    last_quiz_score =
                        VALUES(last_quiz_score),

                    streak =
                        VALUES(streak),

                    badge =
                        VALUES(badge),

                    last_study_date =
                        VALUES(last_study_date)
            `;

            db.query(
                insertSql,
                [
                    student_username,
                    activities_completed || 0,
                    quiz_score || 0,
                    last_quiz_score || 0,
                    streak,
                    badge || "",
                    today
                ],
                (error) => {

                    if (error) {

                        console.error(
                            "Progress save error:",
                            error.message
                        );

                        return res.status(500).json({
                            message:
                                "Failed to save progress"
                        });
                    }

                    res.json({
                        message:
                            "Progress saved successfully",

                        streak:
                            streak,

                        last_study_date:
                            today
                    });
                }
            );
        }
    );
});
app.get("/api/progress/:student_username", (req, res) => {

    const studentUsername =
        req.params.student_username;

    const sql = `
        SELECT
            u.username AS student_username,
            u.age AS age,
            COALESCE(sp.activities_completed, 0)
                AS activities_completed,
            COALESCE(sp.quiz_score, 0)
                AS quiz_score,
            COALESCE(sp.last_quiz_score, 0)
                AS last_quiz_score,
            COALESCE(sp.streak, 0)
                AS streak,
            COALESCE(sp.badge, '')
                AS badge,
            sp.last_study_date

        FROM users u

        LEFT JOIN student_progress sp
            ON u.username = sp.student_username

        WHERE u.username = ?
    `;

    db.query(
        sql,
        [studentUsername],
        (error, results) => {

            if (error) {

                console.error(
                    "Progress load error:",
                    error.message
                );

                return res.status(500).json({
                    message:
                        "Failed to load progress"
                });
            }

            if (results.length === 0) {

                return res.json({
                    student_username:
                        studentUsername,
                    age: null,
                    activities_completed: 0,
                    quiz_score: 0,
                    last_quiz_score: 0,
                    streak: 0,
                    badge: "",
                    last_study_date: null
                });

            }

            res.json(results[0]);

        }
    );
});
/* =====================================================
   CREATE QUIZ
===================================================== */

app.post("/api/quizzes", (req, res) => {

    const {
        teacher_username,
        student_username,
        title,
        questions
    } = req.body;

    if (
        !teacher_username ||
        !student_username ||
        !title ||
        !Array.isArray(questions) ||
        questions.length === 0
    ) {
        return res.status(400).json({
            message:
                "Teacher, student, title and questions are required"
        });
    }

    const quizSql = `
        INSERT INTO quizzes
        (
            teacher_username,
            student_username,
            title
        )
        VALUES (?, ?, ?)
    `;

    db.query(
        quizSql,
        [
            teacher_username,
            student_username,
            title
        ],
        (error, result) => {

            if (error) {

                console.error(
                    "Quiz save error:",
                    error.message
                );

                return res.status(500).json({
                    message:
                        "Failed to save quiz"
                });
            }

            const quizId =
                result.insertId;

            let completed = 0;
            let hasError = false;

            questions.forEach(
                (q) => {

                    if (hasError) {
                        return;
                    }

                    const options =
                        Array.isArray(q.options)
                            ? q.options
                            : [];

                    if (
                        !q.question ||
                        options.length !== 4 ||
                        !q.answer
                    ) {

                        hasError = true;

                        return res.status(400).json({
                            message:
                                "Each question must have 4 options and a correct answer"
                        });
                    }

                    const questionSql = `
                        INSERT INTO quiz_questions
                        (
                            quiz_id,
                            question,
                            option1,
                            option2,
                            option3,
                            option4,
                            correct_answer
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `;

                    db.query(
                        questionSql,
                        [
                            quizId,
                            q.question,
                            options[0],
                            options[1],
                            options[2],
                            options[3],
                            q.answer
                        ],
                        (questionError) => {

                            if (questionError) {

                                if (!hasError) {

                                    hasError = true;

                                    console.error(
                                        "Question save error:",
                                        questionError.message
                                    );

                                    return res.status(500).json({
                                        message:
                                            "Failed to save quiz question"
                                    });
                                }

                                return;
                            }

                            completed++;

                            if (
                                completed ===
                                questions.length &&
                                !hasError
                            ) {

                                res.json({
                                    message:
                                        "Quiz assigned successfully",
                                    quiz_id:
                                        quizId
                                });
                            }
                        }
                    );
                }
            );
        }
    );
});


/* =====================================================
   GET STUDENT QUIZZES
===================================================== */

app.get(
    "/api/quizzes/:student_username",
    (req, res) => {

        const studentUsername =
            req.params.student_username;

        const quizSql = `
            SELECT
                id,
                teacher_username,
                student_username,
                title,
                created_date
            FROM quizzes
            WHERE student_username = ?
            ORDER BY id ASC
        `;

        db.query(
            quizSql,
            [studentUsername],
            (error, quizzes) => {

                if (error) {

                    console.error(
                        "Quiz load error:",
                        error.message
                    );

                    return res.status(500).json({
                        message:
                            "Failed to load quizzes"
                    });
                }

                if (quizzes.length === 0) {

                    return res.json([]);
                }

                let finished = 0;

                quizzes.forEach(
                    (quiz) => {

                        const questionSql = `
                            SELECT
                                id,
                                question,
                                option1,
                                option2,
                                option3,
                                option4,
                                correct_answer
                            FROM quiz_questions
                            WHERE quiz_id = ?
                            ORDER BY id ASC
                        `;

                        db.query(
                            questionSql,
                            [quiz.id],
                            (questionError, questions) => {

                                if (questionError) {

                                    return res.status(500).json({
                                        message:
                                            "Failed to load quiz questions"
                                    });
                                }

                                quiz.questions =
                                    questions.map(
                                        (q) => ({
                                            question:
                                                q.question,

                                            options: [
                                                q.option1,
                                                q.option2,
                                                q.option3,
                                                q.option4
                                            ],

                                            answer:
                                                q.correct_answer
                                        })
                                    );

                                finished++;

                                if (
                                    finished ===
                                    quizzes.length
                                ) {

                                    res.json(
                                        quizzes
                                    );
                                }
                            }
                        );
                    }
                );
            }
        );
    }
);
/* =====================================================
   SAVE QUIZ RESULT
===================================================== */

app.post("/api/quiz-results", (req, res) => {

    const {
        quiz_id,
        student_username,
        score,
        total,
        percentage
    } = req.body;

    if (
        !quiz_id ||
        !student_username ||
        score === undefined ||
        !total ||
        percentage === undefined
    ) {
        return res.status(400).json({
            message: "Quiz result information is required"
        });
    }

    const sql = `
        INSERT INTO quiz_results
        (
            quiz_id,
            student_username,
            score,
            total,
            percentage
        )
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            quiz_id,
            student_username,
            score,
            total,
            percentage
        ],
        (error, result) => {

            if (error) {

                console.error(
                    "Quiz result save error:",
                    error.message
                );

                return res.status(500).json({
                    message:
                        "Failed to save quiz result"
                });
            }

            res.json({
                message:
                    "Quiz result saved successfully",

                result_id:
                    result.insertId
            });

        }
    );

});
/* =====================================================
   GET STUDENT QUIZ RESULTS
===================================================== */

app.get(
    "/api/quiz-results/:student_username",
    (req, res) => {

        const studentUsername =
            req.params.student_username;

        const sql = `
            SELECT
                id,
                quiz_id,
                student_username,
                score,
                total,
                percentage,
                completed_date
            FROM quiz_results
            WHERE student_username = ?
            ORDER BY id DESC
        `;

        db.query(
            sql,
            [studentUsername],
            (error, results) => {

                if (error) {

                    console.error(
                        "Quiz result load error:",
                        error.message
                    );

                    return res.status(500).json({
                        message:
                            "Failed to load quiz results"
                    });
                }

                res.json(results);
            }
        );
    }
);
app.post(
    "/api/recordings",
    upload.single("video"),
    (req, res) => {

        if (!req.file) {

            return res.status(400).json({
                message: "Video file is required"
            });

        }

        const {
            student_username,
            quiz_title
        } = req.body;

        if (!student_username) {

            fs.unlinkSync(req.file.path);

            return res.status(400).json({
                message:
                    "Student username is required"
            });

        }

        const sql = `
            INSERT INTO student_recordings
            (
                student_username,
                quiz_title,
                video_filename
            )
            VALUES (?, ?, ?)
        `;

        db.query(
            sql,
            [
                student_username,
                quiz_title || "Student Quiz",
                req.file.filename
            ],
            (error, result) => {

                if (error) {

                    console.error(
                        "Recording database error:",
                        error.message
                    );

                    try {
                        fs.unlinkSync(req.file.path);
                    } catch (deleteError) {
                        console.error(
                            "File delete error:",
                            deleteError.message
                        );
                    }

                    return res.status(500).json({
                        message:
                            "Failed to save recording"
                    });
                }

                res.json({
                    message:
                        "Recording uploaded successfully",
                    recording_id:
                        result.insertId
                });

            }
        );
    }
);
app.get(
    "/api/recordings/:student_username",
    (req, res) => {

        const studentUsername =
            req.params.student_username;

        const sql = `
            SELECT
                id,
                student_username,
                quiz_title,
                video_filename,
                recorded_date
            FROM student_recordings
            WHERE student_username = ?
            ORDER BY id DESC
        `;

        db.query(
            sql,
            [studentUsername],
            (error, results) => {

                if (error) {

                    console.error(
                        "Recording load error:",
                        error.message
                    );

                    return res.status(500).json({
                        message:
                            "Failed to load recordings"
                    });
                }

                const recordings =
                    results.map((recording) => ({

                        id: recording.id,

                        student_username:
                            recording.student_username,

                        quiz_title:
                            recording.quiz_title,

                        recorded_date:
                            recording.recorded_date,

                        video_url:
                            "/uploads/" +
                            recording.video_filename

                    }));

                res.json(recordings);
            }
        );
    }
);
// Serve frontend files
app.use(express.static(path.join(__dirname, "../frontend")));

// Start backend server
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});
