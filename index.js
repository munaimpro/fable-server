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
        const purchaseCollection = db.collection('purchases');
        const userCollection = db.collection('user');
        const transactionCollection = db.collection('transactions');
        const verifiedWriterCollection = db.collection('verified-writers');


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
                            $sum: "$totalSale"
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

        // Find published ebooks for frontend show
        // app.get('/ebooks', async (request, response) => {
        //     try {
        //         const {
        //             search = '',
        //             genre = 'All',
        //             availability = 'all',
        //             minPrice = 0,
        //             maxPrice = 999999,
        //             sortBy = 'newest',
        //             page = 1,
        //             limit = 8
        //         } = request.query;

        //         const currentPage = parseInt(page);
        //         const perPage = parseInt(limit);

        //         const query = {
        //             status: 'published'
        //         };

        //         // Search by title or writer name
        //         if (search.trim()) {
        //             query.$or = [
        //                 {
        //                     title: {
        //                         $regex: search,
        //                         $options: 'i'
        //                     }
        //                 },
        //                 {
        //                     writerName: {
        //                         $regex: search,
        //                         $options: 'i'
        //                     }
        //                 }
        //             ];
        //         }

        //         // Genre Filter
        //         if (genre !== 'All') {
        //             query.genre = genre;
        //         }

        //         // Availability Filter
        //         if (availability !== 'all') {
        //             query.status = availability;
        //         }

        //         // Price Filter
        //         query.price = {
        //             $gte: Number(minPrice),
        //             $lte: Number(maxPrice)
        //         };

        //         // Sorting
        //         let sortOption = {};

        //         switch (sortBy) {
        //             case 'price-asc':
        //                 sortOption = { price: 1 };
        //                 break;

        //             case 'price-desc':
        //                 sortOption = { price: -1 };
        //                 break;

        //             case 'newest':
        //             default:
        //                 sortOption = { createdAt: -1 };
        //                 break;
        //         }

        //         const total = await ebookCollection.countDocuments(query);

        //         const ebooks = await ebookCollection
        //             .find(query)
        //             .sort(sortOption)
        //             .skip((currentPage - 1) * perPage)
        //             .limit(perPage)
        //             .toArray();

        //         response.status(200).json({
        //             ebooks,
        //             total,
        //             totalPages: Math.ceil(total / perPage),
        //             currentPage
        //         });

        //     } catch (error) {
        //         console.error(error);

        //         response.status(500).json({
        //             message: 'Failed to fetch ebooks'
        //         });
        //     }
        // });

        // Find published ebooks for frontend show
        app.get('/ebooks', async (request, response) => {
            try {
                const {
                    search,
                    genre,
                    availability,
                    minPrice,
                    maxPrice,
                    sortBy,
                    page = 1,
                    limit = 8
                } = request.query;

                const currentPage = parseInt(page);
                const perPage = parseInt(limit);

                // Default query
                const query = {
                    status: 'published'
                };

                // Search by title or writer name
                if (search?.trim()) {
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
                if (genre && genre !== 'All') {
                    query.genre = genre;
                }

                // Availability Filter using totalSale
                if (availability === 'sold') {
                    query.totalSale = { $gt: 0 };
                }

                if (availability === 'available') {
                    query.totalSale = 0;
                }

                // Price Filter
                if (minPrice || maxPrice) {
                    query.price = {};

                    if (minPrice) {
                        query.price.$gte = Number(minPrice);
                    }

                    if (maxPrice) {
                        query.price.$lte = Number(maxPrice);
                    }
                }

                // Sorting
                let sortOption = {
                    createdAt: -1
                };

                // Sold books => highest sold first
                if (availability === 'sold') {
                    sortOption = {
                        totalSale: -1,
                        createdAt: -1
                    };
                }
                // Available books => newest first
                else if (availability === 'available') {
                    sortOption = {
                        createdAt: -1
                    };
                }
                // Normal sorting
                else {
                    switch (sortBy) {
                        case 'price-asc':
                            sortOption = {
                                price: 1
                            };
                            break;

                        case 'price-desc':
                            sortOption = {
                                price: -1
                            };
                            break;

                        case 'newest':
                            sortOption = {
                                createdAt: -1
                            };
                            break;

                        default:
                            sortOption = {
                                createdAt: -1
                            };
                    }
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
                    currentPage,
                    appliedFilters: {
                        search,
                        genre,
                        availability,
                        minPrice,
                        maxPrice,
                        sortBy
                    }
                });

            } catch (error) {
                console.error(error);

                response.status(500).json({
                    success: false,
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

        // Insert single book
        app.post('/ebook', async (request, response) => {
            const ebookData = request.body;
            const finalEbookData = {
                ...ebookData,
                createdAt: new Date()
            };
            const result = await ebookCollection.insertOne(finalEbookData);
            response.json(result);
        });

        // Delete single book
        app.delete('/ebook/:ebookId', async (request, response) => {
            const { ebookId } = request.params;
            console.log(ebookId);
            const result = await ebookCollection.deleteOne({ _id: new ObjectId(ebookId) });
            response.json(result);
        })

        // Find all sales history for a specific writer
        app.get('/purchases/:writerId', async (request, response) => {
            const { writerId } = request.params;
            const result = await purchaseCollection.find({
                writerId
            }).toArray();
            response.send(result);
        });

        // Find all users
        app.get('/users', async (request, response) => {
            const result = await userCollection.find().toArray();
            response.json(result);
        });

        // Update user role
        app.put('/users', async (request, response) => {
            try {
                const { userId, role } = request.body;

                const result = await userCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    {
                        $set: {
                            role
                        }
                    }
                );

                response.json(result);

            } catch (error) {
                console.error(error);
                response.status(500).json({
                    message: 'Failed to update role'
                });
            }
        });

        // Delete single user
        app.delete('/user/:userId', async (request, response) => {
            try {
                const { userId } = request.params;

                // Find user
                const user = await userCollection.findOne({
                    _id: new ObjectId(userId)
                });

                if (!user) {
                    return response.status(404).json({
                        message: 'User not found'
                    });
                }

                // Delete all bookmarks of this user
                await bookmarkCollection.deleteMany({
                    userId
                });

                // If writer, delete all ebooks
                if (user.role === 'writer') {
                    await ebookCollection.deleteMany({
                        writerId: userId
                    });
                }

                // Delete purchase history
                await purchaseCollection.deleteMany({
                    buyerId: userId
                });

                // Delete user account
                const result = await userCollection.deleteOne({
                    _id: new ObjectId(userId)
                });

                response.json({
                    success: true,
                    deletedUser: result.deletedCount,
                    message: 'User and related data deleted successfully'
                });

            } catch (error) {
                console.error(error);
                response.status(500).json({
                    message: 'Failed to delete user'
                });
            }
        });

        // Find all ebooks for admin dashboard
        app.get('/allebooks', async(request, response) => {
            const result = await ebookCollection.find().toArray();
            response.json(result);
        })

        // Find all transactions
        app.get('/transactions', async (request, response) => {
            const result = await transactionCollection.find().toArray();
            response.json(result);
        })

        // Find dashboard analytics (admin dashboard)
        app.get('/analytics', async (request, response) => {
            try {

                // Metrix
                const totalUsers = await userCollection.countDocuments();

                const totalWriters = await userCollection.countDocuments({
                    role: 'writer'
                });

                const purchases = await purchaseCollection.find({
                    paymentStatus: 'paid'
                }).toArray();

                const totalEbooksSold = purchases.length;

                const totalRevenue = purchases.reduce(
                    (sum, purchase) => sum + Number(purchase.amount || 0),
                    0
                );

                // Genre
                const ALL_GENRES = [
                    'Mystery',
                    'Sci-Fi',
                    'Romance',
                    'Fantasy',
                    'Horror',
                    'Fiction'
                ];

                const genreStats = await ebookCollection.aggregate([
                    {
                        $match: {
                            status: 'published'
                        }
                    },
                    {
                        $group: {
                            _id: '$genre',
                            count: {
                                $sum: 1
                            }
                        }
                    }
                ]).toArray();

                const genreMap = {};

                genreStats.forEach(item => {
                    genreMap[item._id] = item.count;
                });

                const genreData = ALL_GENRES.map(genre => ({
                    genre,
                    count: genreMap[genre] || 0
                }));

                // Last 7 months salse
                const now = new Date();

                const startDate = new Date(
                    now.getFullYear(),
                    now.getMonth() - 6,
                    1
                );

                // const monthlySalesRaw = await purchaseCollection.aggregate([
                //     {
                //         $match: {
                //             paymentStatus: 'paid'
                //         }
                //     },
                //     {
                //         $addFields: {
                //             purchaseDateObj: {
                //                 $dateFromString: {
                //                     dateString: '$purchaseDate'
                //                 }
                //             }
                //         }
                //     },
                //     {
                //         $match: {
                //             purchaseDateObj: {
                //                 $gte: startDate
                //             }
                //         }
                //     },
                //     {
                //         $group: {
                //             _id: {
                //                 year: {
                //                     $year: '$purchaseDateObj'
                //                 },
                //                 month: {
                //                     $month: '$purchaseDateObj'
                //                 }
                //             },
                //             revenue: {
                //                 $sum: '$amount'
                //             }
                //         }
                //     },
                //     {
                //         $sort: {
                //             '_id.year': 1,
                //             '_id.month': 1
                //         }
                //     }
                // ]).toArray();

                const monthlySalesRaw = await purchaseCollection.aggregate([
                    {
                        $match: {
                            paymentStatus: 'paid',
                            purchaseDate: {
                                $gte: startDate
                            }
                        }
                    },
                    {
                        $group: {
                            _id: {
                                year: {
                                    $year: '$purchaseDate'
                                },
                                month: {
                                    $month: '$purchaseDate'
                                }
                            },
                            revenue: {
                                $sum: '$price'
                            }
                        }
                    },
                    {
                        $sort: {
                            '_id.year': 1,
                            '_id.month': 1
                        }
                    }
                ]).toArray();

                const monthNames = [
                    'Jan',
                    'Feb',
                    'Mar',
                    'Apr',
                    'May',
                    'Jun',
                    'Jul',
                    'Aug',
                    'Sep',
                    'Oct',
                    'Nov',
                    'Dec'
                ];

                const monthlySales = [];

                for (let i = 6; i >= 0; i--) {

                    const date = new Date(
                        now.getFullYear(),
                        now.getMonth() - i,
                        1
                    );

                    const year = date.getFullYear();
                    const month = date.getMonth() + 1;

                    const found = monthlySalesRaw.find(
                        item =>
                            item._id.year === year &&
                            item._id.month === month
                    );

                    monthlySales.push({
                        month: monthNames[month - 1],
                        revenue: found ? found.revenue : 0
                    });
                }

                // Send response
                response.json({
                    metrics: {
                        totalUsers,
                        totalWriters,
                        totalEbooksSold,
                        totalRevenue
                    },
                    genreData,
                    monthlySales
                });

            } catch (error) {

                console.error(error);

                response.status(500).json({
                    message: 'Failed to load analytics'
                });

            }
        });
        
        // Insert single purchase
        app.post('/purchase', async (request, response) => {
            const { ebookId, ebookTitle, buyerId, buyerName, writerId, paymentStatus, transactionId, price, type, userEmail, amount, status, coverImage, writerName } = request.body;

            const purchaseData = {
                ebookId,
                ebookTitle,
                buyerId,
                buyerName,
                writerId,
                writerName,
                coverImage,
                paymentStatus,
                transactionId,
                price,
                purchaseDate: new Date()
            };

            const transactionData = {
                transactionId,
                type,
                userEmail,
                amount,
                status,
                createdAt: new Date()
            }

            const isPurchaseExist = await purchaseCollection.findOne({
                ebookId,
                buyerId
            });

            if (isPurchaseExist) {
                return response.send({
                    success: false,
                    message: "Already Purchased"
                });
            }

            const purchaseResponse = await purchaseCollection.insertOne(purchaseData);

            await ebookCollection.updateOne(
                { _id: new ObjectId(ebookId) },
                {
                    $inc: {
                        totalSale: 1
                    }
                }
            );

            const transactionResponse = await transactionCollection.insertOne(transactionData);

            return response.send({
                success: true,
                purchaseInsertedId: purchaseResponse.insertedId,
                transactionInsertedId: transactionResponse.insertedId
            });
        });

        // Find all purchase history for a specific user
        app.get('/purchase-history/:buyerId', async (request, response) => {
            const { buyerId } = request.params;
            const result = await purchaseCollection.find({
                buyerId
            }).toArray();
            response.send(result);
        });

        // Find single book purchase and check for a user
        app.get('/purchase-check', async (request, response) => {
            try {
                console.log("PURCHASE CHECK API HIT");

                const { ebookId, buyerId } = request.query;

                console.log('ebookId:', ebookId);
                console.log('buyerId:', buyerId);

                if (!ebookId || !buyerId) {
                    return response.status(400).json({
                        success: false,
                        message: 'ebookId and buyerId are required'
                    });
                }

                const purchase = await purchaseCollection.findOne({
                    ebookId,
                    buyerId,
                    // paymentStatus: 'paid'
                });

                console.log('purchase:', purchase);

                response.status(200).json({
                    success: true,
                    purchased: !!purchase
                });

            } catch (error) {
                console.error(error);

                response.status(500).json({
                    success: false,
                    message: 'Failed to check purchase history'
                });
            }
        });

        // Insert verified writer
        app.post('/purchase', async (request, response) => {
            const writerData = request.body;
            const result = await verifiedWriterCollection.insertOne(writerData);
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