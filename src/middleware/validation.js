const Joi = require('joi');

const registerSchema = Joi.object({
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(6).required(),
  real_name: Joi.string().required(),
  email: Joi.string().email().allow(null, ''),
  department_id: Joi.number().integer().allow(null),
  position: Joi.string().allow(null, ''),
  role: Joi.string().valid('employee', 'manager', 'admin').default('employee'),
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
});

const topicSchema = Joi.object({
  title: Joi.string().min(2).max(200).required().messages({
    'string.empty': '议题标题不能为空',
    'string.min': '议题标题至少2个字符',
    'string.max': '议题标题不能超过200个字符',
    'any.required': '议题标题是必填项',
  }),
  description: Joi.string().allow(null, ''),
  department_id: Joi.number().integer().allow(null),
  vote_rule: Joi.string().valid('simple_majority', 'absolute_majority').default('simple_majority'),
  options: Joi.array().items(Joi.string().min(1)).min(2).max(10).required().messages({
    'array.min': '至少需要2个投票选项',
    'array.max': '最多支持10个投票选项',
    'any.required': '投票选项是必填项',
  }),
  deadline: Joi.date().greater('now').required().messages({
    'date.greater': '截止时间必须晚于当前时间',
    'any.required': '截止时间是必填项',
  }),
  eligible_departments: Joi.array().items(Joi.number()).allow(null),
  eligible_positions: Joi.array().items(Joi.string()).allow(null),
});

const voteSchema = Joi.object({
  topic_id: Joi.number().integer().required(),
  option_id: Joi.number().integer().required(),
});

module.exports = { registerSchema, loginSchema, topicSchema, voteSchema };
