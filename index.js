const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config();
const { jwtVerify, createRemoteJWKSet } = require('jose-cjs');

const mongodburi = process.env.MONGO_URI;

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(mongodburi, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        // Create database and collections
        const db = client.db('fable');
        const ebookCollection = db.collection('ebooks');
        const bookmarkCollection = db.collection('bookmarks');

        const JWKS = createRemoteJWKSet(
            new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
        );

        // Verify Token
        const verifyToken = async (request, response, next) => {
            const authHeader = request.headers.authorization;
            if (!authHeader) {
                response.status(401).json({message: "Unauthorized"});
            }
            
            const token = authHeader.split(" ")[1];

            if (!token) {
                response.status(401).json({ message: "Unauthorized" });
            }

            try {
                const { payload } = await jwtVerify(token, JWKS);
                console.log(payload);
                next()
            } catch (error) {
                return response.status(403).json({message:"forbidden"})
            }
        }

        // Find featured ebooks for homepage
        app.get('/featured-ebooks', async (request, response) => {
            const result = await ebookCollection.find().limit(6).toArray();
            response.json(result);
        });

        // Find top writers for homepage
        app.get('/top-writers', async (request, response) => {
            const result = await ebookCollection.aggregate([
                {
                    $match: {
                        status: "published"
                    }
                },

                {
                    $group: {
                        _id: "$writerId",
                        totalSoldCopies: {
                            $sum: "$totalSales"
                        },
                        genres: {
                            $addToSet: "$genre"
                        }
                    }
                },

                {
                    $sort: {
                        totalSoldCopies: -1
                    }
                },

                {
                    $limit: 3
                },

                {
                    $addFields: {
                        writerObjectId: {
                            $toObjectId: "$_id"
                        }
                    }
                },

                {
                    $lookup: {
                        from: "user",
                        localField: "writerObjectId",
                        foreignField: "_id",
                        as: "writer"
                    }
                },

                {
                    $unwind: "$writer"
                },

                {
                    $project: {
                        _id: 0,
                        writerId: "$writer._id",
                        name: "$writer.name",
                        image: "$writer.image",
                        genres: 1,
                        totalSoldCopies: 1
                    }
                }
            ]).toArray();

            response.json(result);
        });

        // app.get('/debug-writers', async (req, res) => {
        //     const result = await ebookCollection.find().toArray();
        //     res.send(result);
        // });

        app.get('/ebooks', async (request, response) => {
            try {
                const {
                    search = '',
                    genre = 'All',
                    availability = 'all',
                    minPrice = 0,
                    maxPrice = 999999,
                    sortBy = 'newest',
                    page = 1,
                    limit = 8
                } = request.query;

                const currentPage = parseInt(page);
                const perPage = parseInt(limit);

                const query = {
                    status: 'published'
                };

                // Search by title or writer name
                if (search.trim()) {
                    query.$or = [
                        {
                            title: {
                                $regex: search,
                                $options: 'i'
                            }
                        },
                        {
                            writerName: {
                                $regex: search,
                                $options: 'i'
                            }
                        }
                    ];
                }

                // Genre Filter
                if (genre !== 'All') {
                    query.genre = genre;
                }

                // Availability Filter
                if (availability !== 'all') {
                    query.status = availability;
                }

                // Price Filter
                query.price = {
                    $gte: Number(minPrice),
                    $lte: Number(maxPrice)
                };

                // Sorting
                let sortOption = {};

                switch (sortBy) {
                    case 'price-asc':
                        sortOption = { price: 1 };
                        break;

                    case 'price-desc':
                        sortOption = { price: -1 };
                        break;

                    case 'newest':
                    default:
                        sortOption = { createdAt: -1 };
                        break;
                }

                const total = await ebookCollection.countDocuments(query);

                const ebooks = await ebookCollection
                    .find(query)
                    .sort(sortOption)
                    .skip((currentPage - 1) * perPage)
                    .limit(perPage)
                    .toArray();

                response.status(200).json({
                    ebooks,
                    total,
                    totalPages: Math.ceil(total / perPage),
                    currentPage
                });

            } catch (error) {
                console.error(error);

                response.status(500).json({
                    message: 'Failed to fetch ebooks'
                });
            }
        });

        // Find single ebook
        app.get('/ebook/:ebookId', async (request, response) => {
            const { ebookId } = request.params;
            const result = await ebookCollection.findOne({ _id: new ObjectId(ebookId) });
            response.json(result);
        });

        // Find all bookmarks for single user
        app.get('/bookmarks/:userId', async (request, response) => {
            try {
                const { userId } = request.params;

                const result = await bookmarkCollection.aggregate([
                    {
                        $match: {
                            userId
                        }
                    },

                    {
                        $addFields: {
                            ebookObjectId: {
                                $toObjectId: "$ebookId"
                            }
                        }
                    },

                    {
                        $lookup: {
                            from: "ebooks",
                            localField: "ebookObjectId",
                            foreignField: "_id",
                            as: "ebook"
                        }
                    },

                    {
                        $unwind: "$ebook"
                    },

                    {
                        $project: {
                            _id: 1,
                            userId: 1,
                            ebookId: 1,
                            createdAt: 1,
                            ebook: 1
                        }
                    }
                ]).toArray();

                response.json(result);

            } catch (error) {
                console.error(error);

                response.status(500).json({
                    message: 'Failed to fetch bookmarks'
                });
            }
        });

        // Add bookmark by a single user
        app.post('/bookmarks', async (request, response) => {
            try {
                const { ebookId, userId } = request.body;

                const existingBookmark =
                    await bookmarkCollection.findOne({
                        ebookId,
                        userId
                    });

                if (existingBookmark) {
                    await bookmarkCollection.deleteOne({
                        _id: existingBookmark._id
                    });

                    return response.json({
                        bookmarked: false,
                        message: 'Bookmark removed'
                    });
                }

                await bookmarkCollection.insertOne({
                    ebookId,
                    userId,
                    createdAt: new Date()
                });

                response.json({
                    bookmarked: true,
                    message: 'Bookmark added'
                });

            } catch (error) {
                console.error(error);
                response.status(500).json({
                    message: 'Bookmark operation failed'
                });
            }
        });

        // Update book status by writer
        app.put('/ebook/:ebookId', async (request, response) => {
            const { ebookId } = request.params;
            const updatedData = request.body;
            console.log(ebookId);
            const result = await ebookCollection.updateOne(
                { _id: new ObjectId(ebookId) },
                { $set: updatedData }
            );
            response.json(result);
        });

        // Find all ebooks for a specific writer
        app.get('/writer-ebooks/:writerId', async (request, response) => {
            const { writerId } = request.params;
            const result = await ebookCollection.find({
                writerId
            }).toArray();
            response.send(result);
        });

        // Update single ebook
        app.put('/ebook/:ebookId', async (request, response) => {
            const { ebookId } = request.params;
            const updatedData = request.body;
            const result = await ebookCollection.updateOne(
                { _id: new ObjectId(ebookId) },
                { $set: updatedData }
            );
            response.json(result);
        });

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (request, response) => {
    response.send('Server is running fine')
})

app.listen(PORT, () => {
    console.log(`Server running on PORT ${PORT}`);
})