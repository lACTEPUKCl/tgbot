import TelegramBot from "node-telegram-bot-api";
import { Client } from "@googlemaps/google-maps-services-js";
import dotenv from "dotenv";
dotenv.config();

const token = process.env.BOT_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const bot = new TelegramBot(token, { polling: true });
const googleMapsClient = new Client({});
const userAnswers = {};
const questions = [
  {
    key: "номерACC",
    text: "Введите номер ACC (только 5 цифр):",
    type: "text",
    validate: (input) => {
      const accRegex = /^\d{5}$/;
      if (accRegex.test(input)) {
        return { valid: true };
      } else {
        return {
          valid: false,
          error: "Номер ACC должен содержать ровно 5 цифр.",
        };
      }
    },
  },
  {
    key: "номерЗаказа",
    text: "Введите номер заказа (только цифры и символ +):",
    type: "text",
    validate: (input) => {
      const orderRegex = /^[\d+]+$/;
      if (orderRegex.test(input)) {
        return { valid: true };
      } else {
        return {
          valid: false,
          error: "Номер заказа может содержать только цифры и символ +.",
        };
      }
    },
  },
  { key: "имяКлиента", text: "Введите имя клиента:", type: "text" },
  {
    key: "адрес",
    text: "Введите адрес (улица дом город):",
    type: "text",
    validate: async (input) => {
      try {
        const hebrewRegex = /^[\u0590-\u05FF\s0-9"'-,]+$/;
        if (!hebrewRegex.test(input)) {
          return {
            valid: false,
            error: "Адрес должен быть написан на иврите.",
          };
        }

        const response = await googleMapsClient.geocode({
          params: {
            address: normalizeAddress(input),
            region: "il",
            language: "he",
            key: GOOGLE_API_KEY,
          },
        });

        if (response.data.results.length > 0) {
          const result = response.data.results[0];
          const city = result.address_components.find((c) =>
            c.types.includes("locality")
          )?.long_name;
          const street = result.address_components.find((c) =>
            c.types.includes("route")
          )?.long_name;
          const building = result.address_components.find((c) =>
            c.types.includes("street_number")
          )?.long_name;

          const normalizedUserAddress = normalizeAddress(input);
          const normalizedGoogleAddress = normalizeAddress(
            `${street} ${building} ${city}`
          );

          if (normalizedUserAddress === normalizedGoogleAddress) {
            return { valid: true, address: { city, street, building } };
          } else {
            const suggestions = response.data.results
              .map((r) => r.formatted_address)
              .slice(0, 5);

            const cleanedSuggestions = suggestions.map((address) =>
              address.replace(/, ישראל$/, "").trim()
            );

            return { valid: false, suggestions: cleanedSuggestions };
          }
        }

        return { valid: false, error: "Адрес не найден." };
      } catch (error) {
        console.error("Ошибка проверки адреса:", error);
        return { valid: false, error: "Ошибка подключения к Google API." };
      }
    },
  },
  { key: "порты", text: "Введите номера портов:", type: "text" },
  { key: "поп", text: "Введите ПОП:", type: "text" },
  {
    key: "панельКлиентаТип",
    text: "Панель у клиента была или поставил новую?",
    type: "choice",
    choices: [
      ["Была", "была"],
      ["Поставил новую", "новая"],
    ],
  },
  {
    key: "панельКлиента",
    text: "Введите порты на панели клиента:",
    type: "text",
  },
  { key: "расстояние", text: "Введите расстояние в метрах:", type: "text" },
];

const normalizeAddress = (address) => {
  return address
    .toLowerCase()
    .replace(/[^א-ת0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const askNextQuestion = async (chatId) => {
  const user = userAnswers[chatId];
  const currentStep = user.currentStep;
  const question = questions[currentStep];
  console.log(user);

  if (!question) {
    const address = user["адрес"];
    const report = `
    חיבור לקוח עסקי
    ACC-${user["номерACC"] || ""}
    ${user["номерЗаказа"] || ""} ${user["имяКлиента"] || ""}
    ${address?.street || ""}${
      address?.building ? ` ${address.building} ` : " "
    }${address?.city || ""}
    פורטים: ${user["порты"] || ""}
    אתר מזין - ${user["поп"] || ""}
    פנל לקוחות ${user["панельКлиентаТип"] === "была" ? "קיים" : ""}
    פורטים ${user["панельКлиента"]?.toUpperCase() || ""}
    מרחק ${user["расстояние"]?.replace(/[^0-9]/g, "") || ""} OTDR
    `.trim();

    bot.sendMessage(chatId, report);
    return;
  }

  if (question.type === "choice") {
    bot.sendMessage(chatId, question.text, {
      reply_markup: {
        inline_keyboard: question.choices.map(([text, data]) => [
          { text, callback_data: data },
        ]),
      },
    });
  } else {
    bot.sendMessage(chatId, question.text);
  }
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  userAnswers[chatId] = {
    currentStep: 0,
  };

  askNextQuestion(chatId);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (userAnswers[chatId]) {
    const user = userAnswers[chatId];
    const currentStep = user.currentStep;
    const question = questions[currentStep];

    if (question && question.type === "text") {
      if (question.validate) {
        const validatedInput = await question.validate(msg.text);

        if (!validatedInput.valid) {
          if (
            validatedInput.suggestions &&
            validatedInput.suggestions.length > 0
          ) {
            const suggestions = validatedInput.suggestions.map((s, i) => ({
              text: s,
              callback_data: s,
            }));

            user.suggestions = validatedInput.suggestions;

            bot.sendMessage(
              chatId,
              `Мы не смогли найти точный адрес. Возможно, вы имели в виду:`,
              {
                reply_markup: {
                  inline_keyboard: suggestions.map((suggestion) => [
                    suggestion,
                  ]),
                },
              }
            );
            return;
          }

          bot.sendMessage(
            chatId,
            validatedInput.error || "Ошибка! Попробуйте снова."
          );
          return;
        }

        user[question.key] =
          question.key === "адрес" && validatedInput.address
            ? validatedInput.address
            : msg.text;
      } else {
        user[question.key] = msg.text;
      }

      user.currentStep += 1;
      askNextQuestion(chatId);
    }
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const answer = query.data;
  const user = userAnswers[chatId];
  const currentStep = user.currentStep;
  const question = questions[currentStep];

  if (user.suggestions) {
    const selectedAddress = user.suggestions.find(
      (suggestion) => suggestion === answer
    );

    if (selectedAddress) {
      const addressParts = selectedAddress.split(",");
      if (addressParts.length >= 2) {
        user["адрес"] = {
          street: addressParts[0].trim(),
          city: addressParts[1]?.trim(),
        };
      }

      user.currentStep += 1;
      askNextQuestion(chatId);
      return;
    }
  }

  user[question.key] = answer;
  user.currentStep += 1;
  askNextQuestion(chatId);
});
